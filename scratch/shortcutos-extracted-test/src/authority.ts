export enum AuthorityLevel {
  SYSTEM = 0,
  DEVELOPER = 1,
  TOOL_RUNTIME = 2,
  USER = 3,
  SHORTCUTOS = 4,
  MISSION = 5,
  TASK = 6,
  COMMAND = 7
}

export function canOverride(actor: AuthorityLevel, target: AuthorityLevel): boolean {
  return actor < target;
}
