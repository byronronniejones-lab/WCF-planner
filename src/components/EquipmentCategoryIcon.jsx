// eslint-disable-next-line no-unused-vars -- JSX-only use (eslint flat config has no react/jsx-uses-vars rule)
import PlannerIcon from './PlannerIcon.jsx';
import {EQUIPMENT_CATEGORY_ICON_KEYS} from '../lib/plannerIcons.js';

// Renders an equipment-category icon. Each EQUIPMENT_CATEGORIES key maps
// to a PlannerIcon image under public/icons/planner/ via
// EQUIPMENT_CATEGORY_ICON_KEYS. The emoji string on EQUIPMENT_CATEGORIES.icon
// stays in place as the option-text fallback for the two <select><option>
// dropdowns (EquipmentAddModal, EquipmentWebformsAdmin) since browsers
// can't render <img> inside <option>.
export default function EquipmentCategoryIcon({category, size = 18}) {
  const iconKey = category ? EQUIPMENT_CATEGORY_ICON_KEYS[category.key] : null;
  return <PlannerIcon iconKey={iconKey} text={category ? category.icon : null} size={size} />;
}
