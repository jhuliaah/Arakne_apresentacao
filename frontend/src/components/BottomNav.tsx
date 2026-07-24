export type NavTarget = "catalog" | "comunidade" | "projetos" | "perfil";

interface BottomNavProps {
  active: NavTarget;
  onNavigate: (target: NavTarget) => void;
}

const ITEMS: { target: NavTarget; label: string; icon: string }[] = [
  { target: "catalog", label: "Home", icon: "🏡" },
  { target: "comunidade", label: "Comunidade", icon: "🧶" },
  { target: "projetos", label: "Projetos", icon: "🧵" },
  { target: "perfil", label: "Bancada", icon: "🙂" },
];

export default function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => (
        <button
          key={item.target}
          className={`bottom-nav__item ${active === item.target ? "bottom-nav__item--active" : ""}`}
          onClick={() => onNavigate(item.target)}
          aria-label={item.label}
        >
          <span className="bottom-nav__icon">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
