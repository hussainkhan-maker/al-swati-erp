// One place for the app's voice, so it never talks over the person and never hears itself:
//  • say(): the microphone is closed first, then the app speaks. While it speaks, nothing it says is written down.
//  • hush(): the app stops speaking at once (the person tapped the microphone or closed the page).
import * as Speech from "expo-speech";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";

let speaking = false;
export const isSpeaking = () => speaking;
export function stopListening() { try { ExpoSpeechRecognitionModule.abort(); } catch { /* not listening */ } }
export function hush() { speaking = false; try { Speech.stop(); } catch { /* no voice on this device */ } }
export function say(text: string, opts: Record<string, any> = {}) {
  if (!text) return;
  stopListening();
  try { Speech.stop(); } catch { /* no voice on this device */ }
  speaking = true;
  const done = () => { speaking = false; };
  try { Speech.speak(text, { ...opts, onDone: done, onStopped: done, onError: done }); } catch { speaking = false; }
  // If the device never reports the end, do not stay deaf for ever.
  setTimeout(done, Math.min(60000, 4000 + text.length * 120));
}
