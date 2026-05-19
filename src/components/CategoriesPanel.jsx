import MenuPanel from './MenuPanel';

// Categories live inside MenuPanel. For now this is just an alias —
// could later be its own focused panel.
export default function CategoriesPanel(props) {
  return <MenuPanel {...props} initialTab="categories" />;
}
