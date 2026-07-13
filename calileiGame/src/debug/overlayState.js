// overlayState.js — All meta-state for the debug overlay.
//
// Lives outside the World because the overlay is a developer tool, not
// game state. Mutating these fields never affects gameplay — the game
// runs identically whether the overlay is on, off, or being edited.
//
// State pieces:
//
//   enabled               — overlay visibility toggle.
//
//   recordedHistory       — a captured snapshot of HISTORY_FRAMES of
//                           world state, frozen for inspection. Newest
//                           at index 0. NOT continuously updated —
//                           filled only when a recording is active.
//                           Survives overlay-toggle off/on.
//
//   isRecording           — true while a capture is in progress. Each
//                           frame while true, the world snapshot is
//                           pushed onto recordedHistory and progress
//                           is incremented. When progress reaches
//                           HISTORY_FRAMES, isRecording flips to false
//                           and the capture is complete.
//
//   recordingProgress     — number of frames captured into the current
//                           recording so far. Reaches HISTORY_FRAMES
//                           when complete.
//
//   recordingCapturedAt   — the world frame number when the recording
//                           was triggered. Displayed as a label so the
//                           user knows when the capture started.
//
//   selectedColorState    — the name of the state whose color is being
//                           edited in the color editor panel. null when
//                           no state is selected.
//
//   activeSliderDrag      — the slider currently being dragged. Shape:
//                           { stateName, channel: 'h'|'s'|'l',
//                             max, trackX }
//                           When set, mousemove updates the value.

export const HISTORY_FRAMES = 20;

export const overlayState = {
  enabled: false,
  recordedHistory: [],
  isRecording: false,
  recordingProgress: 0,
  recordingCapturedAt: null,
  selectedColorState: null,
  activeSliderDrag: null,
};

export function toggleOverlay() {
  overlayState.enabled = !overlayState.enabled;
}

// Start (or restart) a recording. If a recording was in progress, it's
// discarded — the press always means "begin a fresh capture from this
// moment forward."
export function startRecording(currentFrame) {
  overlayState.recordedHistory = [];
  overlayState.isRecording = true;
  overlayState.recordingProgress = 0;
  overlayState.recordingCapturedAt = currentFrame;
}
