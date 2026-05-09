// Shared planner icon component. Resolves a stable icon key (see
// src/lib/plannerIcons.js) to /icons/planner/<key>.png and renders it as
// an <img> with sane defaults: fixed-box layout, object-fit: contain,
// non-draggable, decorative by default (alt="" + aria-hidden).
//
// Fallback: if a `text` prop is supplied and the key is unknown (or
// `key` is missing), the component renders the text/emoji string at the
// same size box. This is how nav cards, tabs, and dailys headings stay
// resilient when the icon set is incomplete.
//
// For accessible icon-only buttons, pass `alt` and the parent should
// supply `aria-label`/`title`. Decorative icons (the common case) keep
// the alt="" + aria-hidden defaults.
//
// Browsers do NOT render <img> inside <option>; consumers using <select>
// keep emoji/text labels for option text and use this component
// elsewhere (e.g. above the select).

import {plannerIconUrl} from '../lib/plannerIcons.js';

export default function PlannerIcon({iconKey, size = 18, alt = '', text = null, style, imgStyle, className}) {
  const url = plannerIconUrl(iconKey);
  const boxStyle = {
    width: size,
    height: size,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    verticalAlign: 'middle',
    ...style,
  };

  if (url) {
    return (
      <img
        src={url}
        alt={alt}
        aria-hidden={alt === '' ? 'true' : undefined}
        draggable="false"
        className={className}
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          display: 'inline-block',
          verticalAlign: 'middle',
          flex: '0 0 auto',
          ...imgStyle,
        }}
      />
    );
  }

  // Fallback: text/emoji string at the same box size.
  if (text != null) {
    return (
      <span aria-hidden={alt === '' ? 'true' : undefined} className={className} style={{...boxStyle, fontSize: size}}>
        {text}
      </span>
    );
  }

  // Neither key nor text: render an empty fixed-box so layout is stable.
  return <span className={className} aria-hidden="true" style={boxStyle} />;
}

/**
 * Compose an icon + label inline, gap controlled by caller. Used in
 * nav cards / dailys headings / list rows where both pieces are visible.
 */
export function PlannerIconLabel({iconKey, text = null, size = 18, gap = 6, alt = '', children, style, imgStyle}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap,
        verticalAlign: 'middle',
        ...style,
      }}
    >
      <PlannerIcon iconKey={iconKey} text={text} size={size} alt={alt} imgStyle={imgStyle} />
      <span>{children}</span>
    </span>
  );
}
