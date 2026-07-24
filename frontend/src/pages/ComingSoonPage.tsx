import Header from "../components/Header";
import RecoveryBellHost from "../components/RecoveryBellHost";
import BottomNav, { type NavTarget } from "../components/BottomNav";

interface ComingSoonPageProps {
  active: NavTarget;
  title: string;
  onNavigate: (target: NavTarget) => void;
}

export default function ComingSoonPage({ active, title, onNavigate }: ComingSoonPageProps) {
  return (
    <div className="page">
      <Header>
        <RecoveryBellHost />
      </Header>
      <main className="onboarding onboarding--centered">
        <div className="onboarding__glyph">🧵</div>
        <h1 className="onboarding__title">{title}</h1>
        <p className="onboarding__tagline">Essa parte ainda está sendo tricotada — em breve por aqui.</p>
      </main>
      <BottomNav active={active} onNavigate={onNavigate} />
    </div>
  );
}
