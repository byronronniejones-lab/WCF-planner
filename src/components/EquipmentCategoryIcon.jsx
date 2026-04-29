import React from 'react';

// Renders an equipment-category icon. For most categories the value in
// EQUIPMENT_CATEGORIES.icon is a single emoji string (🚜, 🛵, 🛻, …) and
// is rendered as text. The Mowers category alone uses an inline SVG
// silhouette because Unicode has no riding-lawnmower emoji and the
// previous fallback (🪚 handsaw) read as the wrong tool.
//
// EQUIPMENT_CATEGORIES still carries an emoji string for Mowers ('🌱')
// — it's the fallback used by the two <select><option> dropdowns
// (EquipmentAddModal, EquipmentWebformsAdmin) since browsers won't
// render SVG inside option text.
//
// Color flows through `currentColor` so the surrounding `color` style
// drives the stroke (Mowers palette: #a16207).
export default function EquipmentCategoryIcon({category, size = 18}) {
  if (category && category.key === 'mowers') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{display: 'inline-block', verticalAlign: 'middle', color: '#a16207'}}
        aria-label="Mower"
      >
        <rect x="2" y="13" width="9" height="3" rx="0.5" />
        <rect x="11" y="9" width="9" height="5" rx="1" />
        <path d="M16 9 L16 6 L19 6 L19 9" />
        <line x1="13" y1="9" x2="13" y2="6" />
        <line x1="11.5" y1="6" x2="14.5" y2="6" />
        <circle cx="4" cy="17.5" r="1.5" />
        <circle cx="17" cy="17.5" r="2" />
      </svg>
    );
  }
  return <span style={{fontSize: size}}>{category && category.icon}</span>;
}
