import { warmMenuOfficialGroup, peekMenuOfficialGroup } from '../utils/menuOfficialGroupSettings';
import { warmSistemaSettings } from '../utils/sistemaSettings';
import { warmHigherLowerPack } from '../minigames/higherLower/packCache';

/**
 * Prefetch meta promo Partite (slide minigiochi / confronto) + pack HL se possibile.
 * Da chiamare a login/bootstrap così il tab Partite non “salta” da 1 a N slide.
 */
export async function warmMatchesPromoMeta() {
  const [group] = await Promise.all([
    warmMenuOfficialGroup(),
    warmSistemaSettings(),
  ]);
  const gid = Number(group?.id || peekMenuOfficialGroup()?.id || 0);
  if (gid > 0) {
    try {
      warmHigherLowerPack(gid);
    } catch (_) {}
  }
  return group;
}
