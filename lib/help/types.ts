/** Роли, для которых есть справка (включая водителя — не staff users.role). */
export type HelpRole =
  | 'admin'
  | 'manager'
  | 'dispatcher'
  | 'operator'
  | 'laborant'
  | 'mehanik'
  | 'guest'
  | 'driver';

/** Если указано — блок виден только этим ролям. */
type HelpBlockVisibility = {
  roles?: HelpRole[];
};

export type HelpBlock =
  | ({ type: 'h2'; text: string } & HelpBlockVisibility)
  | ({ type: 'h3'; text: string } & HelpBlockVisibility)
  | ({ type: 'p'; text: string } & HelpBlockVisibility)
  | ({ type: 'ol'; items: string[] } & HelpBlockVisibility)
  | ({ type: 'ul'; items: string[] } & HelpBlockVisibility)
  | ({ type: 'callout'; tone: 'tip' | 'warn'; text: string } & HelpBlockVisibility);

export interface HelpArticle {
  id: string;
  title: string;
  /** Кратко для чеклиста онбординга */
  summary: string;
  roles: HelpRole[];
  /** Pathname страницы, к которой привязана статья (опционально) */
  route?: string;
  /** Несколько path для одной статьи (например блок Продажи) */
  routes?: string[];
  body: HelpBlock[];
}

/** Блоки без roles — всем; с roles — только перечисленным. */
export function filterHelpBlocksForRole(
  body: HelpBlock[],
  role: string | null | undefined,
): HelpBlock[] {
  return body.filter((block) => {
    if (!block.roles?.length) return true;
    if (!role) return false;
    return block.roles.includes(role as HelpRole);
  });
}
