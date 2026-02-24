use std::io::Cursor;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Sample, SampleFormat, Stream, StreamConfig};
use hound::{SampleFormat as HoundSampleFormat, WavSpec, WavWriter};

use crate::types::AudioDevice;

pub struct AudioState {
    pub is_recording: Arc<AtomicBool>,
    pub samples: Arc<Mutex<Vec<f32>>>,
    pub stream: Arc<Mutex<Option<Stream>>>,
    pub sample_rate: Arc<Mutex<Option<u32>>>,
}

unsafe impl Send for AudioState {}
unsafe impl Sync for AudioState {}

impl AudioState {
    pub fn new() -> Self {
        Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            samples: Arc::new(Mutex::new(Vec::new())),
            stream: Arc::new(Mutex::new(None)),
            sample_rate: Arc::new(Mutex::new(None)),
        }
    }
}


/// Briefly open a mic stream to trigger the macOS permission prompt at startup.
/// Runs on a background thread — no-op if permission is already granted.
pub fn request_mic_permission() {
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => return,
    };
    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(_) => return,
    };
    let stream_config: StreamConfig = config.into();
    // Build a short-lived input stream — this triggers the TCC prompt.
    let stream = device.build_input_stream(
        &stream_config,
        |_data: &[f32], _: &cpal::InputCallbackInfo| {},
        |_err| {},
        None,
    );
    if let Ok(s) = stream {
        let _ = s.play();
        // Keep stream alive briefly so the OS registers the access.
        std::thread::sleep(std::time::Duration::from_millis(100));
        drop(s);
    }
}

pub fn list_audio_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();
    let default_device = host.default_input_device();
    let default_id = default_device
        .as_ref()
        .and_then(|device| device.id().ok())
        .map(|id| format!("{id:?}"));
    let default_name = default_device
        .as_ref()
        .and_then(|device| device.description().ok())
        .map(|description| description.name().to_string());

    let devices = host.input_devices().map_err(|err| err.to_string())?;
    let mut entries = Vec::new();

    for device in devices {
        let description = device.description().map_err(|err| err.to_string())?;
        let name = description.name().to_string();
        let id = device.id().map_err(|err| err.to_string())?;
        let id = format!("{id:?}");
        let is_default = default_id
            .as_ref()
            .is_some_and(|default_id| default_id == &id)
            || default_name
                .as_ref()
                .is_some_and(|default_name| default_name == &name);

        entries.push(AudioDevice {
            name,
            id,
            is_default,
        });
    }

    Ok(entries)
}

pub fn start_recording(state: &AudioState, device_id: Option<&str>) -> Result<(), String> {
    let start_result = state.is_recording.compare_exchange(
        false,
        true,
        Ordering::SeqCst,
        Ordering::SeqCst,
    );
    if start_result.is_err() {
        return Err("Recording already in progress".to_string());
    }

    let operation = (|| -> Result<(), String> {
        let host = cpal::default_host();
        let device = match device_id {
            Some(id) => find_input_device(&host, id)?,
            None => host
                .default_input_device()
                .ok_or_else(|| "No default input device available".to_string())?,
        };

        let supported_config = device
            .default_input_config()
            .map_err(|err| err.to_string())?;
        let sample_rate = supported_config.sample_rate();
        let channels = supported_config.channels();
        let sample_format = supported_config.sample_format();
        let config: StreamConfig = supported_config.into();

        {
            let mut buffer = state.samples.lock().map_err(|err| err.to_string())?;
            buffer.clear();
        }
        {
            let mut rate = state.sample_rate.lock().map_err(|err| err.to_string())?;
            *rate = Some(sample_rate);
        }

        let samples = state.samples.clone();

        let stream = match sample_format {
            SampleFormat::I8 => build_input_stream::<i8>(&device, &config, channels, samples)?,
            SampleFormat::I16 => build_input_stream::<i16>(&device, &config, channels, samples)?,
            SampleFormat::I24 => build_input_stream::<cpal::I24>(&device, &config, channels, samples)?,
            SampleFormat::I32 => build_input_stream::<i32>(&device, &config, channels, samples)?,
            SampleFormat::I64 => build_input_stream::<i64>(&device, &config, channels, samples)?,
            SampleFormat::U8 => build_input_stream::<u8>(&device, &config, channels, samples)?,
            SampleFormat::U16 => build_input_stream::<u16>(&device, &config, channels, samples)?,
            SampleFormat::U24 => build_input_stream::<cpal::U24>(&device, &config, channels, samples)?,
            SampleFormat::U32 => build_input_stream::<u32>(&device, &config, channels, samples)?,
            SampleFormat::U64 => build_input_stream::<u64>(&device, &config, channels, samples)?,
            SampleFormat::F32 => build_input_stream::<f32>(&device, &config, channels, samples)?,
            SampleFormat::F64 => build_input_stream::<f64>(&device, &config, channels, samples)?,
            SampleFormat::DsdU8 | SampleFormat::DsdU16 | SampleFormat::DsdU32 => {
                return Err("DSD sample formats are not supported".to_string())
            }
            _ => {
                return Err(format!(
                    "Unsupported sample format '{sample_format}'"
                ))
            }
        };

        stream.play().map_err(|err| err.to_string())?;

        let mut stream_guard = state.stream.lock().map_err(|err| err.to_string())?;
        *stream_guard = Some(stream);

        Ok(())
    })();

    if let Err(err) = operation {
        state.is_recording.store(false, Ordering::SeqCst);
        return Err(err);
    }

    Ok(())
}

pub fn stop_recording(state: &AudioState) -> Result<Vec<u8>, String> {
    if !state.is_recording.swap(false, Ordering::SeqCst) {
        return Err("Recording is not active".to_string());
    }

    {
        let mut stream_guard = state.stream.lock().map_err(|err| err.to_string())?;
        if stream_guard.is_none() {
            return Err("Audio stream was not initialized".to_string());
        }
        stream_guard.take();
    }

    let samples = {
        let mut buffer = state.samples.lock().map_err(|err| err.to_string())?;
        let captured = buffer.clone();
        buffer.clear();
        captured
    };

    let sample_rate = {
        let mut rate = state.sample_rate.lock().map_err(|err| err.to_string())?;
        let stored = rate.ok_or_else(|| "Sample rate missing".to_string())?;
        *rate = None;
        stored
    };

    encode_wav(&samples, sample_rate)
}

pub fn encode_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let spec = WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 32,
        sample_format: HoundSampleFormat::Float,
    };

    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = WavWriter::new(&mut cursor, spec).map_err(|err| err.to_string())?;
        for &sample in samples {
            writer.write_sample(sample).map_err(|err| err.to_string())?;
        }
        writer.finalize().map_err(|err| err.to_string())?;
    }
    Ok(cursor.into_inner())
}

fn find_input_device(host: &cpal::Host, device_id: &str) -> Result<cpal::Device, String> {
    let devices = host.input_devices().map_err(|err| err.to_string())?;
    for device in devices {
        let description = device.description().map_err(|err| err.to_string())?;
        let name = description.name().to_string();
        let id = device.id().map_err(|err| err.to_string())?;
        let id = format!("{id:?}");
        if id == device_id || name == device_id {
            return Ok(device);
        }
    }

    Err(format!("Input device '{device_id}' not found"))
}

fn build_input_stream<T>(
    device: &cpal::Device,
    config: &StreamConfig,
    channels: u16,
    samples: Arc<Mutex<Vec<f32>>>,
) -> Result<Stream, String>
where
    T: cpal::SizedSample + Sample,
{
    let stream = device
        .build_input_stream(
            config,
            move |data: &[T], _| capture_input_data(data, channels, &samples),
            handle_stream_error,
            None,
        )
        .map_err(|err| err.to_string())?;

    Ok(stream)
}

fn capture_input_data<T: Sample>(input: &[T], channels: u16, samples: &Arc<Mutex<Vec<f32>>>) {
    if channels == 0 {
        return;
    }

    let channel_count = channels as usize;
    let mut collected = Vec::with_capacity(input.len() / channel_count);
    for frame in input.chunks(channel_count) {
        if let Some(sample) = frame.first() {
            let value = sample.to_float_sample().to_sample::<f32>();
            collected.push(value);
        }
    }

    match samples.lock() {
        Ok(mut buffer) => buffer.extend(collected),
        Err(err) => eprintln!("Failed to lock audio buffer: {err}"),
    }
}

fn handle_stream_error(err: cpal::StreamError) {
    eprintln!("Audio stream error: {err}");
}
