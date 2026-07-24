import { Home, Users, FolderHeart, CircleUser, type LucideIcon } from "lucide-react";

export type NavTarget = "catalog" | "comunidade" | "projetos" | "perfil";

const ITEMS: { target: NavTarget; label: string; Icon: LucideIcon }[] = [
  { target: "catalog", label: "Home", Icon: Home },
  { target: "comunidade", label: "Comunidade", Icon: Users },
  { target: "projetos", label: "Projetos", Icon: FolderHeart },
  { target: "perfil", label: "Bancada", Icon: CircleUser },
];

interface BottomNavProps {
  active: NavTarget;
  onNavigate: (target: NavTarget) => void;
}

export default function BottomNav({ active, onNavigate }: BottomNavProps) {
  return (
    <nav className="bottom-nav">
      {ITEMS.map(({ target, label, Icon }) => (
        <button
          key={target}
          className={`bottom-nav__item ${active === target ? "bottom-nav__item--active" : ""}`}
          onClick={() => onNavigate(target)}
          aria-label={label}
        >
          <span className="bottom-nav__icon">
            <Icon size={21} strokeWidth={active === target ? 2 : 1.75} />
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
