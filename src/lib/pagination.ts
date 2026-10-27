/** Liste sayfalama: url'deki `sayfa` parametresi ve sınırlandırılmış sayfa bilgisi. */

export const LIST_PAGE_SIZE = 50;

export type PageInfo = { page: number; pages: number; offset: number; limit: number; total: number };

/** `sayfa` parametresini 1 tabanlı tam sayıya çevirir; geçersizse 1. */
export function parsePage(raw: string | undefined | null): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** İstenen sayfayı toplam kayda göre sınırlar (son sayfadan öteye gidilmez). */
export function pageInfo(total: number, requested: number, size = LIST_PAGE_SIZE): PageInfo {
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(pages, Math.max(1, requested));
  return { page, pages, offset: (page - 1) * size, limit: size, total };
}
