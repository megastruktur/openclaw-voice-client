import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { marked } from 'marked';
import { AppSettings, SessionResponse, TranscriptionResponse, ConnectionResult } from './types';
marked.setOptions({ breaks: true, gfm: true });

let settings: AppSettings | null = null;
let sessionId: string | null = null;
let connected = false;
let isRecording = false;
let isProcessing = false;
let error: string | null = null;
let recordingReady: Promise<void> | null = null;

const statusEl = document.getElementById('status') as HTMLElement;
const micButton = document.getElementById('mic-button') as HTMLButtonElement;
const micLabel = document.getElementById('mic-label') as HTMLElement;
const exchangeEl = document.getElementById('exchange') as HTMLElement;
const errorEl = document.getElementById('error') as HTMLElement;
const sessionIdEl = document.getElementById('session-id') as HTMLElement;
const newSessionBtn = document.getElementById('new-session-btn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const quitBtn = document.getElementById('quit-btn') as HTMLButtonElement;
const minimizeBtn = document.getElementById('minimize-btn') as HTMLButtonElement;

async function loadSettings() {
  try {
    settings = await invoke<AppSettings>('load_settings');
    if (settings && settings.gatewayUrl) {
      testConnection(settings.gatewayUrl);
    } else {
      showError('Settings not configured');
    }
  } catch (e) {
    showError('Failed to load settings: ' + e);
  }
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testConnection(baseUrl: string, attempt = 1): Promise<void> {
  try {
    const result = await invoke<ConnectionResult>('test_connection', { baseUrl });
    updateStatus(result.success);
    if (!result.success) {
      if (attempt < MAX_RETRIES) {
        updateStatus(false);
        statusEl.textContent = `○ Retrying (${attempt}/${MAX_RETRIES})…`;
        await delay(RETRY_DELAY_MS);
        return testConnection(baseUrl, attempt + 1);
      }
      showError(result.error || 'Connection failed');
    } else {
      clearError();
      if (!sessionId) {
        await handleNewSession();
      }
    }
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      updateStatus(false);
      statusEl.textContent = `○ Retrying (${attempt}/${MAX_RETRIES})…`;
      await delay(RETRY_DELAY_MS);
      return testConnection(baseUrl, attempt + 1);
    }
    updateStatus(false);
    showError('Connection error: ' + e);
  }
}

function updateStatus(isConnected: boolean) {
  connected = isConnected;
  if (isConnected) {
    statusEl.textContent = '● Connected';
    statusEl.classList.remove('disconnected');
    statusEl.classList.add('connected');
    micButton.disabled = false;
    micLabel.textContent = 'Hold to Speak';
  } else {
    statusEl.textContent = '○ Disconnected';
    statusEl.classList.remove('connected');
    statusEl.classList.add('disconnected');
    micButton.disabled = true;
    micLabel.textContent = 'Disconnected';
  }
}

async function handleNewSession() {
  if (!settings || !settings.gatewayUrl || !settings.profileName) {
    showError('Missing settings (URL or Profile)');
    return;
  }

  try {
    const response = await invoke<SessionResponse>('create_session', {
      baseUrl: settings.gatewayUrl,
      profileName: settings.profileName
    });
    sessionId = response.sessionId;
    sessionIdEl.textContent = sessionId;
    exchangeEl.innerHTML = ''; // Clear history
    clearError();
  } catch (e) {
    showError('Failed to create session: ' + e);
  }
}

async function startRecording() {
  if (!connected || isProcessing || !settings || !sessionId) return;
  isRecording = true;
  micButton.classList.add('recording');
  micLabel.textContent = 'Listening...';
  recordingReady = invoke('start_recording', {
    deviceId: settings.microphoneDeviceId || null
  });

  try {
    await recordingReady;
  } catch (e) {
    isRecording = false;
    recordingReady = null;
    micButton.classList.remove('recording');
    micLabel.textContent = 'Error';
    showError('Recording failed: ' + e);
  }
}

async function stopAndSend() {
  if (!isRecording || !settings || !sessionId) return;
  // Wait for start_recording to complete before stopping
  if (recordingReady) {
    try {
      await recordingReady;
    } catch {
      // start_recording failed — nothing to stop
      recordingReady = null;
      return;
    }
    recordingReady = null;
  }

  isRecording = false;
  micButton.classList.remove('recording');
  micButton.classList.add('processing');
  micLabel.textContent = 'Processing...';
  isProcessing = true;

  try {
    const response = await invoke<TranscriptionResponse>('stop_and_send', {
      baseUrl: settings.gatewayUrl,
      sessionId: sessionId,
      profileName: settings.profileName,
      sessionKey: settings.sessionKey || null
    });

    // Display transcription
    const userDiv = document.createElement('div');
    userDiv.className = 'exchange-user';
    userDiv.textContent = `You: ${response.transcription.text}`;
    exchangeEl.appendChild(userDiv);

    const agentDiv = document.createElement('div');
    agentDiv.className = 'exchange-assistant';
    agentDiv.innerHTML = marked.parse(response.response.text) as string;
    exchangeEl.appendChild(agentDiv);

    // Scroll to bottom
    exchangeEl.scrollTop = exchangeEl.scrollHeight;

  } catch (e) {
    showError('Processing failed: ' + e);
  } finally {
    isProcessing = false;
    micButton.classList.remove('processing');
    micLabel.textContent = 'Hold to Speak';
  }
}

function showError(msg: string) {
  error = msg;
  errorEl.textContent = msg;
  errorEl.style.display = 'block';
}

function clearError() {
  error = null;
  errorEl.style.display = 'none';
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  newSessionBtn.addEventListener('click', handleNewSession);
  
  settingsBtn.addEventListener('click', () => {
    invoke('open_settings_window');
  });

  quitBtn.addEventListener('click', () => {
    invoke('quit_app');
  });

  minimizeBtn.addEventListener('click', () => {
    getCurrentWindow().hide();
  });

  // Mic button interactions
  micButton.addEventListener('mousedown', startRecording);
  micButton.addEventListener('mouseup', stopAndSend);
  micButton.addEventListener('mouseleave', () => {
    if (isRecording) {
      stopAndSend();
    }
  });
});
