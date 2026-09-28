// Ícone de cada nicho (lib/prospeccao/nichos.ts) — usado nos filtros da tela
// e no painel do perfil de busca. Nicho sem ícone próprio cai em Shapes.
import { BedDouble, CakeSlice, CookingPot, HeartPulse, PartyPopper, Shapes, UtensilsCrossed, WashingMachine, type LucideIcon } from 'lucide-react';

const ICONE_NICHO: Record<string, LucideIcon> = {
  hotelaria: BedDouble,
  saude: HeartPulse,
  lavanderias: WashingMachine,
  alimentacao: CookingPot,
  buffets: CakeSlice,
  restaurantes: UtensilsCrossed,
  eventos: PartyPopper,
};

export function iconeDoNicho(id: string): LucideIcon {
  return ICONE_NICHO[id] ?? Shapes;
}
