/** App header — neutral branding with yarn ball logo.
 *
 *  Track 4D: aceita um slot opcional à direita (children) para a Lane D
 *  plugar o `RecoveryBell` (sino de pedidos de recuperação disfarçado).
 *  Quando não há children, o header fica como antes (só logo + tagline).
 */

import type { ReactNode } from "react";

interface HeaderProps {
  /** Slot à direita do header (ex.: RecoveryBell). Opcional. */
  children?: ReactNode;
}

export default function Header({ children }: HeaderProps) {
  return (
    <header className="header">
      <div className="header__logo">
        <img src="/favicon.svg" alt="" className="header__icon" />
        <span className="header__name">Arakne</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span className="header__tagline">crochê & tecelagem</span>
        {children}
      </div>
    </header>
  );
}
