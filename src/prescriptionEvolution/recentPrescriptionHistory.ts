export interface LinkedPrescriptionInstance {
  contentIdentity: string;
  previousProgramInstanceId: string | null;
}

/** Pure bounded walker shared by production and read-scope tests. */
export async function collectRecentPrescriptionSessions<TSessions>(input: {
  uid: string;
  previousProgramInstanceId: string | null;
  maximumSessions: number;
  loadInstance(uid: string, programInstanceId: string): Promise<LinkedPrescriptionInstance | null>;
  loadProgramSessions(uid: string, contentIdentity: string): Promise<TSessions | null>;
}): Promise<TSessions[]> {
  const history: TSessions[] = [];
  let cursor = input.previousProgramInstanceId;
  while (cursor && history.length < input.maximumSessions) {
    const instance = await input.loadInstance(input.uid, cursor);
    if (!instance) break;
    const sessions = await input.loadProgramSessions(input.uid, instance.contentIdentity);
    if (sessions) history.push(sessions);
    cursor = instance.previousProgramInstanceId;
  }
  return history;
}
