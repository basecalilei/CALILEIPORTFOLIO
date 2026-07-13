// format.js — Compact formatting helpers + color conversion.
//
// Pulled out of overlay.js so it can be shared across panels (live stats,
// history, color editor) without creating circular imports.

// Format a number with 2 decimal places, padded to fixed width.
// Padding is what keeps numerical columns aligned in monospace text.
export function fmt(n, width = 7) {
  return n.toFixed(2).padStart(width, ' ');
}

// Format a number with 1 decimal place. Tighter for compact rows.
export function fmt1(n, width = 6) {
  return n.toFixed(1).padStart(width, ' ');
}

// Render -1/0/+1 as a width-2 signed string.
export function signed(n) {
  if (n > 0) return '+1';
  if (n < 0) return '-1';
  return ' 0';
}

// Render boolean as '1' or '0'.
export function bit(b) {
  return b ? '1' : '0';
}

// --- Color conversions ---
//
// The color editor stores authored colors as hex strings (the format
// matched by states.js), but exposes them to the user via H/S/L sliders.
// These two functions are the bridge.

// Convert '#rrggbb' or '#rgb' to { h: 0..360, s: 0..100, l: 0..100 }.
export function hexToHSL(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const r = parseInt(h.substr(0, 2), 16) / 255;
  const g = parseInt(h.substr(2, 2), 16) / 255;
  const b = parseInt(h.substr(4, 2), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  let sat = 0;
  const light = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    sat = light > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) hue = ((b - r) / d + 2);
    else hue = ((r - g) / d + 4);
    hue *= 60;
  }

  return {
    h: Math.round(hue),
    s: Math.round(sat * 100),
    l: Math.round(light * 100),
  };
}

// Convert { h: 0..360, s: 0..100, l: 0..100 } to '#rrggbb'.
export function hslToHex(h, s, l) {
  const sFrac = s / 100;
  const lFrac = l / 100;
  const c = (1 - Math.abs(2 * lFrac - 1)) * sFrac;
  const hPrime = h / 60;
  const x = c * (1 - Math.abs((hPrime % 2) - 1));
  const m = lFrac - c / 2;

  let r;
  let g;
  let b;
  if (hPrime < 1)      { r = c; g = x; b = 0; }
  else if (hPrime < 2) { r = x; g = c; b = 0; }
  else if (hPrime < 3) { r = 0; g = c; b = x; }
  else if (hPrime < 4) { r = 0; g = x; b = c; }
  else if (hPrime < 5) { r = x; g = 0; b = c; }
  else                 { r = c; g = 0; b = x; }

  const toHex = (v) => {
    const n = Math.round((v + m) * 255);
    const clamped = Math.max(0, Math.min(255, n));
    return clamped.toString(16).padStart(2, '0');
  };

  return '#' + toHex(r) + toHex(g) + toHex(b);
}
