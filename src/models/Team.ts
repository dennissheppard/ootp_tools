export interface Team {
  id: number;
  name: string;
  nickname: string;
  parentTeamId: number;
  leagueId?: number;
}
