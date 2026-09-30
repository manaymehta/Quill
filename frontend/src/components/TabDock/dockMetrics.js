// Single source of truth for TabDock geometry. Each pair is [home, editor] —
// the dock interpolates between them as it compacts while an editor tab is active.
import { MOBILE_QUERY } from '../../constants/breakpoints';

export const DOCK_MOBILE_QUERY = MOBILE_QUERY;

// Same on phone and desktop
const SHARED = {
  pillPaddingLeft:  [16, 14],
  pillPaddingRight: [12, 10],
  toastGap:         [8, 6], // space between the toast capsule and the dock
  toastPaddingLeft:      [16, 14],
  toastPaddingRight:     [16, 14],
  toastPaddingRightUndo: [10, 8], // tighter when the round undo button sits at the right edge
};

export const DOCK_METRICS = {
  mobile: {
    ...SHARED,
    height:        [58, 48],
    radius:        [30, 25],
    circle:        [42, 34],
    separator:     [22, 18],
    pill:          [42, 34],
    pillMaxWidth:  [130, 115],
    undo:          [34, 30],
    paddingBottom: [8, 4],
    editorGap:     6, // space between the editor's bottom edge and the compact dock
  },
  desktop: {
    ...SHARED,
    height:        [54, 44],
    radius:        [28, 24],
    circle:        [40, 32],
    separator:     [20, 16],
    pill:          [40, 32],
    pillMaxWidth:  [160, 130],
    undo:          [32, 28],
    paddingBottom: [16, 4],
    editorGap:     4,
  },
};

// Bottom clearance the editor overlay reserves so it ends just above the compact dock.
export const getEditorClearance = (m) => m.height[1] + m.paddingBottom[1] + m.editorGap;
