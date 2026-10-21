import { useCallback, useState } from 'react';
import { MOBILE_QUERY } from '../../constants/breakpoints';

// Where a note or folder menu opens, by how it was opened (`anchor.kind`):
//   'pointer'  right-click: its corner at the cursor, flipped left / up where it would leave the
//              screen, like the system's own menus
//   'touch'    long-press: centred on the finger, opening downwards clear of the fingertip; upwards
//              only when there's no room below. It used to open with its corner at the touch point,
//              under the finger.
//   'button'   the ⋮ button: under it, right edges lined up so it opens over its own card; above it
//              when there's no room below
// From the menu's real size (each menu used its own guessed height), kept 8px inside the screen and
// above the dock on phones.
const EDGE_PX = 8;
const PHONE_DOCK_CLEARANCE_PX = 76;
const ABOVE_FINGER_PX = 16;
const BELOW_FINGER_PX = 36;
const BUTTON_GAP_PX = 6;

// Which kind of right-click / contextmenu event this was: Android fires one for a long-press too
export const contextMenuKind = (e) => (
    e.nativeEvent?.pointerType === 'touch' || e.nativeEvent?.sourceCapabilities?.firesTouchEvents ? 'touch' : 'pointer'
);

export const buttonAnchor = (button) => {
    const r = button.getBoundingClientRect();
    return { kind: 'button', top: r.top, bottom: r.bottom, right: r.right };
};

// { left, top, up }: `up` = it opens above what opened it, so it unfolds upwards
export const menuPosition = (anchor, width, height) => {
    const rightLimit = window.innerWidth - EDGE_PX;
    const bottomLimit = window.innerHeight - (window.matchMedia(MOBILE_QUERY).matches ? PHONE_DOCK_CLEARANCE_PX : EDGE_PX);

    let x;
    let y;
    if (anchor.kind === 'touch') {
        x = anchor.x - width / 2;
        y = anchor.y + BELOW_FINGER_PX;
        if (y + height > bottomLimit) y = anchor.y - ABOVE_FINGER_PX - height;
    } else if (anchor.kind === 'button') {
        x = anchor.right - width;
        y = anchor.bottom + BUTTON_GAP_PX;
        if (y + height > bottomLimit) y = anchor.top - BUTTON_GAP_PX - height;
    } else {
        x = anchor.x + width > rightLimit ? anchor.x - width : anchor.x;
        y = anchor.y + height > bottomLimit ? anchor.y - height : anchor.y;
    }

    const left = Math.round(Math.max(EDGE_PX, Math.min(x, rightLimit - width)));
    const top = Math.round(Math.max(EDGE_PX, Math.min(y, bottomLimit - height)));
    const anchorY = anchor.kind === 'button' ? anchor.bottom : anchor.y;
    return { left, top, up: top + height / 2 < anchorY };
};

// For a plain (non-framer) popup, like the folder colour picker: placed straight onto the element
export const placeMenu = (el, anchor) => {
    if (!el || !anchor) return;
    const r = el.getBoundingClientRect();
    const { left, top, up } = menuPosition(anchor, r.width, r.height);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.transformOrigin = up ? 'bottom' : 'top';
};

// For the animated menus. Which way a menu opens has to be known before its opening animation
// starts (the menu, its slide and each row's drift all mirror for a menu opening upwards), so the
// menu is first rendered hidden just to measure it (`measureRef`), then shown, already placed, with
// `placement` = { left, top, up }. Both happen before the screen is painted. `placement` stays set
// while the menu animates closed, and resets when the anchor does.
export const useMenuPlacement = (anchor) => {
    const [placed, setPlaced] = useState(null);
    const measureRef = useCallback((el) => {
        if (!el || !anchor) return;
        const r = el.getBoundingClientRect();
        setPlaced({ anchor, ...menuPosition(anchor, r.width, r.height) });
    }, [anchor]);
    return [measureRef, placed && placed.anchor === anchor ? placed : null];
};

// The original menu opening, unchanged, only mirrored for a menu that opens upwards (custom = up):
// it unfolds from the edge nearest what opened it, slides 8px away from it and its rows drift 4px
// the same way; closing reverses it.
export const shutterMenuVariants = {
    closed: (up) => ({
        opacity: 0,
        scaleY: 0.82,
        y: up ? 8 : -8,
        transition: {
            duration: 0.12,
            ease: [0.4, 0, 1, 1],
        },
    }),
    open: {
        opacity: 1,
        scaleY: 1,
        y: 0,
        transition: {
            duration: 0.16,
            ease: [0.16, 1, 0.3, 1],
        },
    },
};

export const shutterItemVariants = {
    closed: (up) => ({
        opacity: 0,
        y: up ? 4 : -4,
        transition: {
            duration: 0.1,
            ease: [0.4, 0, 1, 1],
        },
    }),
    open: {
        opacity: 1,
        y: 0,
        transition: {
            duration: 0.15,
            ease: [0.16, 1, 0.3, 1],
        },
    },
};

// Touch screens (phones, tablets) get the same menu scaled up evenly, every part by the same factor,
// so its rows are big enough for a finger and it still looks the same. Put on the menu's inner box
// (not the positioned one: zoom would scale its left/top too).
export const TOUCH_MENU_ZOOM = 'pointer-coarse:[zoom:1.25]';
