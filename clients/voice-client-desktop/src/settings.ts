import { invoke } from '@tauri-apps/api/core';
import { AppSettings, AudioDevice, ConnectionResult } from './types';

document.addEventListener('DOMContentLoaded', () => {
  const gatewayUrlInput = document.getElementById('gateway-url') as HTMLInputElement;
  const tokenInput = document.getElementById('token') as HTMLInputElement;
  const profileNameInput = document.getElementById('profile-name') as HTMLInputElement;
  const sessionKeyInput = document.getElementById('session-key') as HTMLInputElement;
  const microphoneSelect = document.getElementById('microphone-device') as HTMLSelectElement;
  const hotkeyInput = document.getElementById('push-to-talk-hotkey') as HTMLInputElement;
  
  const testButton = document.getElementById('test-connection') as HTMLButtonElement;
  const testResult = document.getElementById('test-result') as HTMLDivElement;
  const saveButton = document.getElementById('save-settings') as HTMLButtonElement;

  function clearStatus() {
    testResult.style.display = 'none';
    if (saveButton.textContent === '✓ Saved!') {
      saveButton.textContent = 'Save Settings';
      saveButton.disabled = false;
    }
  }

  // Load settings
  invoke<AppSettings>('load_settings').then((settings) => {
    if (settings.gatewayUrl) gatewayUrlInput.value = settings.gatewayUrl;
    if (settings.token) tokenInput.value = settings.token;
    if (settings.profileName) profileNameInput.value = settings.profileName;
    if (settings.sessionKey) sessionKeyInput.value = settings.sessionKey;
    if (settings.pushToTalkHotkey) hotkeyInput.value = settings.pushToTalkHotkey;
    
    const savedMicId = settings.microphoneDeviceId || '';
    
    // Load audio devices
    invoke<AudioDevice[]>('list_audio_devices').then((devices) => {
      // Clear existing options except the first one
      while (microphoneSelect.options.length > 1) {
        microphoneSelect.remove(1);
      }

      devices.forEach((device) => {
        const option = document.createElement('option');
        option.value = device.id;
        option.text = device.name;
        microphoneSelect.add(option);
      });

      // Set selected value
      microphoneSelect.value = savedMicId;
    });
  });

  // Test Connection
  testButton.addEventListener('click', async () => {
    testButton.disabled = true;
    testResult.style.display = 'none';
    testResult.className = 'test-result';
    testResult.textContent = 'Testing...';
    testResult.style.display = 'block';

    try {
      const baseUrl = gatewayUrlInput.value;
      const result = await invoke<ConnectionResult>('test_connection', { baseUrl });
      
      testResult.className = result.success ? 'test-result success' : 'test-result error';
      testResult.textContent = result.success ? 'Connection successful!' : (result.error || 'Connection failed');
    } catch (error) {
      testResult.className = 'test-result error';
      testResult.textContent = `Error: ${error}`;
    } finally {
      testButton.disabled = false;
    }
  });

  // Save Settings
  saveButton.addEventListener('click', async () => {
    const originalText = 'Save Settings';
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    const settings: AppSettings = {
      gatewayUrl: gatewayUrlInput.value,
      token: tokenInput.value,
      profileName: profileNameInput.value,
      sessionKey: sessionKeyInput.value,
      microphoneDeviceId: microphoneSelect.value,
      pushToTalkHotkey: hotkeyInput.value
    };

    try {
      await invoke('save_settings', { settings });
      saveButton.textContent = '✓ Saved!';
      setTimeout(() => {
        if (saveButton.textContent === '✓ Saved!') {
          saveButton.textContent = originalText;
          saveButton.disabled = false;
        }
      }, 2000);
    } catch (error) {
      saveButton.textContent = 'Error!';
      console.error(error);
      setTimeout(() => {
        saveButton.textContent = originalText;
        saveButton.disabled = false;
      }, 2000);
    }
  });

  // Clear status on change
  const inputs = [gatewayUrlInput, tokenInput, profileNameInput, sessionKeyInput, hotkeyInput];
  inputs.forEach(input => {
    input.addEventListener('input', clearStatus);
  });
  microphoneSelect.addEventListener('change', clearStatus);
});
