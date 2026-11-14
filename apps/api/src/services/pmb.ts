/** Read-only view of an applicant in the PMB system (mock during the research, AS-01). */
export interface PmbApplicant {
  regNo: string;
  name: string;
  email: string;
  phone: string;
  program: string;
  path: string;
  stage: string;
  paymentStatus: string;
  documents: Array<{ docType: string; label: string; status: string }>;
  deadlines: Array<{ code: string; label: string; at: string }>;
  isDummy?: boolean;
}

export interface TestSlots {
  allowed: boolean;
  reason?: string;
  current?: { id: string; label: string; at: string };
  slots: Array<{ id: string; label: string; at: string }>;
}

export interface PmbAdapter {
  readonly available: boolean;
  getTestSlots(regNo: string): Promise<TestSlots>;
  /** The only write operation (FR-14): allowed only when the PMB system's own policy allows it. */
  reschedule(regNo: string, slotId: string): Promise<{ ok: boolean; slot?: { id: string; label: string; at: string } }>;
  getApplicant(regNo: string): Promise<PmbApplicant | null>;
  listApplicants(): Promise<Array<Pick<PmbApplicant, "regNo" | "stage" | "documents" | "deadlines">>>;
}

/** The only path to the PMB system (FR-70). Read operations only in Phase 1. */
export class HttpPmbAdapter implements PmbAdapter {
  readonly available: boolean;
  constructor(private readonly baseUrl: string) {
    this.available = Boolean(baseUrl);
  }
  async getApplicant(regNo: string): Promise<PmbApplicant | null> {
    if (!this.available) return null;
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/applicants/${encodeURIComponent(regNo)}`, { signal: AbortSignal.timeout(3000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`PMB HTTP ${res.status}`);
    return (await res.json()) as PmbApplicant;
  }
  async getTestSlots(regNo: string): Promise<TestSlots> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/applicants/${encodeURIComponent(regNo)}/test-slots`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`PMB HTTP ${res.status}`);
    return (await res.json()) as TestSlots;
  }
  async reschedule(regNo: string, slotId: string) {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/applicants/${encodeURIComponent(regNo)}/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId }),
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 409) return { ok: false };
    if (!res.ok) throw new Error(`PMB HTTP ${res.status}`);
    return (await res.json()) as { ok: boolean; slot?: { id: string; label: string; at: string } };
  }
  async listApplicants() {
    if (!this.available) return [];
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/applicants`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`PMB HTTP ${res.status}`);
    return (await res.json()) as Array<Pick<PmbApplicant, "regNo" | "stage" | "documents" | "deadlines">>;
  }
}
