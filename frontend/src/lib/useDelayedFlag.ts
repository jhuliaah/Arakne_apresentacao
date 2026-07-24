/** useDelayedFlag — só retorna true se o flag estiver ativo por mais que `delay` ms.
 *
 *  Uso típico: evitar flash de skeleton em carregamentos rápidos.
 *  Se a resposta chegar antes de `delay`, o skeleton nunca aparece.
 */
import { useEffect, useState } from "react";

export function useDelayedFlag(flag: boolean, delay = 500): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (flag) {
      const t = window.setTimeout(() => setShown(true), delay);
      return () => window.clearTimeout(t);
    }
    setShown(false);
  }, [flag, delay]);

  return shown;
}
