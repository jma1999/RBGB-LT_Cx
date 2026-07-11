const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SPREADSHEET_ID = import.meta.env
  .VITE_GOOGLE_SPREADSHEET_ID as string | undefined;

const GOOGLE_SCOPE = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

let tokenClient: GoogleTokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiresAt = 0;

export interface GoogleUser {
  email: string;
  name?: string;
  picture?: string;
}

export interface SheetAssignment {
  floor: string;
  regionId: string;
  regionLabel: string;
  spaceId: string | null;
  roomNo: string;
  spaceType: string;
  updatedBy: string;
  updatedAt: string;
  revision: number;
}

export interface SheetComment {
  commentId: string;
  floor: string;
  regionId: string;
  spaceId: string;
  roomNo: string;
  comment: string;
  createdBy: string;
  createdAt: string;
  category: string;
}

interface ValueRangeResponse {
  range?: string;
  majorDimension?: string;
  values?: Array<Array<string | number | boolean>>;
}

function requireConfiguration(): { clientId: string; spreadsheetId: string } {
  if (!CLIENT_ID || !SPREADSHEET_ID) {
    throw new Error(
      "Google Sheets is not configured. Add VITE_GOOGLE_CLIENT_ID and VITE_GOOGLE_SPREADSHEET_ID to your .env file.",
    );
  }

  return {
    clientId: CLIENT_ID,
    spreadsheetId: SPREADSHEET_ID,
  };
}

async function waitForGoogleIdentity(timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();

  while (!window.google?.accounts?.oauth2) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        "Google Identity Services did not load. Check the script tag in index.html and your internet connection.",
      );
    }

    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

export async function initializeGoogleSheets(): Promise<void> {
  const { clientId } = requireConfiguration();
  await waitForGoogleIdentity();

  if (tokenClient) {
    return;
  }

  tokenClient = window.google!.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: GOOGLE_SCOPE,
    callback: () => undefined,
  });
}

export function isGoogleSheetsConnected(): boolean {
  return Boolean(accessToken && Date.now() < tokenExpiresAt - 30_000);
}

export async function connectGoogleSheets(): Promise<GoogleUser> {
  await initializeGoogleSheets();

  return new Promise<GoogleUser>((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error("Google authentication has not initialized."));
      return;
    }

    tokenClient.callback = async (response) => {
      if (response.error || !response.access_token) {
        reject(
          new Error(
            response.error_description ??
              response.error ??
              "Google authorization was not completed.",
          ),
        );
        return;
      }

      accessToken = response.access_token;
      tokenExpiresAt =
        Date.now() + Math.max(0, Number(response.expires_in ?? 3600)) * 1000;

      try {
        const user = await fetchGoogleUser();
        resolve(user);
      } catch (error) {
        disconnectGoogleSheets();
        reject(error);
      }
    };

    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

export function disconnectGoogleSheets(): void {
  const tokenToRevoke = accessToken;
  accessToken = null;
  tokenExpiresAt = 0;

  if (tokenToRevoke && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(tokenToRevoke, () => undefined);
  }
}

function requireAccessToken(): string {
  if (!isGoogleSheetsConnected() || !accessToken) {
    accessToken = null;
    tokenExpiresAt = 0;
    throw new Error(
      "Your Google Sheets session is not connected or has expired. Reconnect Google Sheets and try again.",
    );
  }

  return accessToken;
}

async function authenticatedFetch<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const token = requireAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    accessToken = null;
    tokenExpiresAt = 0;
  }

  if (!response.ok) {
    let message = `Google Sheets request failed (${response.status}).`;

    try {
      const payload = (await response.json()) as {
        error?: { message?: string };
      };
      message = payload.error?.message ?? message;
    } catch {
      // Keep the default message when the response is not JSON.
    }

    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function fetchGoogleUser(): Promise<GoogleUser> {
  const token = requireAccessToken();
  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error("The signed-in Google account could not be identified.");
  }

  const user = (await response.json()) as Partial<GoogleUser>;

  if (!user.email) {
    throw new Error("Google did not return an email address for this account.");
  }

  return {
    email: user.email,
    name: user.name,
    picture: user.picture,
  };
}

function rangeUrl(range: string): string {
  const { spreadsheetId } = requireConfiguration();
  return `${SHEETS_API_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}`;
}

async function getValues(range: string): Promise<ValueRangeResponse> {
  return authenticatedFetch<ValueRangeResponse>(rangeUrl(range));
}

async function updateValues(
  range: string,
  values: Array<Array<string | number | boolean>>,
): Promise<void> {
  await authenticatedFetch(
    `${rangeUrl(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ values }),
    },
  );
}

async function appendValues(
  range: string,
  values: Array<Array<string | number | boolean>>,
): Promise<void> {
  await authenticatedFetch(
    `${rangeUrl(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      body: JSON.stringify({ values }),
    },
  );
}

function stringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function loadAssignments(
  floor: string,
): Promise<Record<string, string | null>> {
  const response = await getValues("RegionAssignments!A2:I");
  const assignments: Record<string, string | null> = {};

  for (const row of response.values ?? []) {
    if (stringValue(row[0]) !== floor) {
      continue;
    }

    const regionId = stringValue(row[1]);
    if (!regionId) {
      continue;
    }

    assignments[regionId] = stringValue(row[3]) || null;
  }

  return assignments;
}

export async function upsertAssignment(
  assignment: Omit<SheetAssignment, "updatedAt" | "revision">,
): Promise<SheetAssignment> {
  const response = await getValues("RegionAssignments!A2:I");
  const rows = response.values ?? [];
  const existingIndex = rows.findIndex(
    (row) =>
      stringValue(row[0]) === assignment.floor &&
      stringValue(row[1]) === assignment.regionId,
  );

  const existingRevision =
    existingIndex >= 0 ? numberValue(rows[existingIndex][8]) : 0;

  const savedAssignment: SheetAssignment = {
    ...assignment,
    updatedAt: new Date().toISOString(),
    revision: existingRevision + 1,
  };

  const rowValues: Array<string | number> = [
    savedAssignment.floor,
    savedAssignment.regionId,
    savedAssignment.regionLabel,
    savedAssignment.spaceId ?? "",
    savedAssignment.roomNo,
    savedAssignment.spaceType,
    savedAssignment.updatedBy,
    savedAssignment.updatedAt,
    savedAssignment.revision,
  ];

  if (existingIndex >= 0) {
    const sheetRow = existingIndex + 2;
    await updateValues(
      `RegionAssignments!A${sheetRow}:I${sheetRow}`,
      [rowValues],
    );
  } else {
    await appendValues("RegionAssignments!A:I", [rowValues]);
  }

  await appendActivity({
    eventType: savedAssignment.spaceId
      ? "assignment_saved"
      : "assignment_cleared",
    floor: savedAssignment.floor,
    regionId: savedAssignment.regionId,
    spaceId: savedAssignment.spaceId ?? "",
    user: savedAssignment.updatedBy,
    payload: savedAssignment,
  });

  return savedAssignment;
}

export async function loadComments(
  floor: string,
  regionId: string,
): Promise<SheetComment[]> {
  const response = await getValues("Comments!A2:I");

  return (response.values ?? [])
    .filter(
      (row) =>
        stringValue(row[1]) === floor &&
        stringValue(row[2]) === regionId,
    )
    .map((row) => ({
      commentId: stringValue(row[0]),
      floor: stringValue(row[1]),
      regionId: stringValue(row[2]),
      spaceId: stringValue(row[3]),
      roomNo: stringValue(row[4]),
      comment: stringValue(row[5]),
      createdBy: stringValue(row[6]),
      createdAt: stringValue(row[7]),
      category: stringValue(row[8]) || "General",
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function appendActivity(input: {
  eventType: string;
  floor: string;
  regionId: string;
  spaceId: string;
  user: string;
  payload: unknown;
}): Promise<void> {
  await appendValues("ActivityLog!A:H", [
    [
      globalThis.crypto?.randomUUID?.() ??
        `event-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      input.eventType,
      input.floor,
      input.regionId,
      input.spaceId,
      input.user,
      new Date().toISOString(),
      JSON.stringify(input.payload),
    ],
  ]);
}

export async function addComment(
  comment: Omit<SheetComment, "commentId" | "createdAt">,
): Promise<SheetComment> {
  const savedComment: SheetComment = {
    ...comment,
    commentId:
      globalThis.crypto?.randomUUID?.() ??
      `comment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
  };

  await appendValues("Comments!A:I", [
    [
      savedComment.commentId,
      savedComment.floor,
      savedComment.regionId,
      savedComment.spaceId,
      savedComment.roomNo,
      savedComment.comment,
      savedComment.createdBy,
      savedComment.createdAt,
      savedComment.category,
    ],
  ]);

  await appendActivity({
    eventType: "comment_added",
    floor: savedComment.floor,
    regionId: savedComment.regionId,
    spaceId: savedComment.spaceId,
    user: savedComment.createdBy,
    payload: savedComment,
  });

  return savedComment;
}
