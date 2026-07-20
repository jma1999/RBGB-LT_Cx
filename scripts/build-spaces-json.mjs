import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, "data-source");
const OUTPUT_DIR = path.join(ROOT, "public", "data");

const FLOOR_CONFIG = {
  "03": {
    planFile: "/floors/floor-03-base.svg",
    viewBox: "0 0 792 612",
  },
  "04": {
    planFile: "/floors/floor-04-base.svg",
    viewBox: "0 0 792 612",
  },
};

function readCsv(filename) {
  const fullPath = path.join(SOURCE_DIR, filename);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Missing input file: ${fullPath}`);
  }

  const text = fs.readFileSync(fullPath, "utf8");
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  if (parsed.errors.length > 0) {
    const details = parsed.errors
      .map((error) => `row ${error.row ?? "?"}: ${error.message}`)
      .join("\n");

    throw new Error(`${filename} could not be parsed:\n${details}`);
  }

  return parsed.data.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "string" ? value.trim() : value,
      ]),
    ),
  );
}

function requireHeaders(rows, filename, headers) {
  const existingHeaders = new Set(
    rows.length > 0 ? Object.keys(rows[0]) : [],
  );

  const missing = headers.filter(
    (header) => !existingHeaders.has(header),
  );

  if (missing.length > 0) {
    throw new Error(
      `${filename} is missing required header(s): ${missing.join(", ")}`,
    );
  }
}

function required(value, label) {
  const text = String(value ?? "").trim();

  if (!text) {
    throw new Error(`Missing required value: ${label}`);
  }

  return text;
}

function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nullableNumber(value, label) {
  const text = String(value ?? "").trim();

  if (!text) {
    return null;
  }

  const number = Number(text);

  if (!Number.isFinite(number)) {
    throw new Error(`${label} must be a number. Received: ${text}`);
  }

  return number;
}

function integer(value, label) {
  const number = nullableNumber(value, label);

  if (number === null || !Number.isInteger(number)) {
    throw new Error(`${label} must be an integer.`);
  }

  return number;
}

function uniqueKey(parts) {
  return parts.join("::");
}

const spacesRows = readCsv("spaces.csv");
const itemRows = readCsv("space-items.csv");
const catalogRows = readCsv("device-catalog.csv");
const templateRows = readCsv("test-templates.csv");

requireHeaders(spacesRows, "spaces.csv", [
  "floor",
  "sourceRow",
  "spaceId",
  "roomNo",
  "spaceType",
  "displayName",
  "regionId",
  "spaceNotes",
  "daylightZone",
  "emergencyFixtures",
]);

requireHeaders(itemRows, "space-items.csv", [
  "floor",
  "spaceId",
  "itemId",
  "deviceType",
  "expectedQty",
  "itemNotesOverride",
  "testTemplateOverride",
]);

requireHeaders(catalogRows, "device-catalog.csv", [
  "deviceType",
  "category",
  "description",
  "defaultTestTemplate",
]);

requireHeaders(templateRows, "test-templates.csv", [
  "templateKey",
  "testId",
  "label",
  "instructions",
  "sortOrder",
]);

const catalogByDeviceType = new Map();

for (const row of catalogRows) {
  const deviceType = required(
    row.deviceType,
    "device-catalog.csv → deviceType",
  );

  if (catalogByDeviceType.has(deviceType)) {
    throw new Error(
      `Duplicate deviceType in device-catalog.csv: ${deviceType}`,
    );
  }

  catalogByDeviceType.set(deviceType, {
    category: required(
      row.category,
      `${deviceType} → category`,
    ),
    description: String(row.description ?? "").trim(),
    defaultTestTemplate: required(
      row.defaultTestTemplate,
      `${deviceType} → defaultTestTemplate`,
    ),
  });
}

const testsByTemplate = new Map();
const testIdsByTemplate = new Map();

for (const row of templateRows) {
  const templateKey = required(
    row.templateKey,
    "test-templates.csv → templateKey",
  );
  const testId = required(
    row.testId,
    `${templateKey} → testId`,
  );

  const ids = testIdsByTemplate.get(templateKey) ?? new Set();

  if (ids.has(testId)) {
    throw new Error(
      `Duplicate testId "${testId}" in template "${templateKey}".`,
    );
  }

  ids.add(testId);
  testIdsByTemplate.set(templateKey, ids);

  const tests = testsByTemplate.get(templateKey) ?? [];
  tests.push({
    id: testId,
    label: required(
      row.label,
      `${templateKey}/${testId} → label`,
    ),
    ...(String(row.instructions ?? "").trim()
      ? { instructions: String(row.instructions).trim() }
      : {}),
    sortOrder:
      nullableNumber(
        row.sortOrder,
        `${templateKey}/${testId} → sortOrder`,
      ) ?? 999,
  });
  testsByTemplate.set(templateKey, tests);
}

for (const [templateKey, tests] of testsByTemplate) {
  tests.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      a.label.localeCompare(b.label),
  );
  testsByTemplate.set(
    templateKey,
    tests.map(({ sortOrder, ...test }) => test),
  );
}

for (const [deviceType, catalog] of catalogByDeviceType) {
  if (!testsByTemplate.has(catalog.defaultTestTemplate)) {
    throw new Error(
      `Device ${deviceType} references unknown template: ` +
        catalog.defaultTestTemplate,
    );
  }
}

const spacesById = new Map();
const spaceIdsByFloor = new Map();

for (const row of spacesRows) {
  const floor = required(row.floor, "spaces.csv → floor");
  const spaceId = required(row.spaceId, "spaces.csv → spaceId");
  const config = FLOOR_CONFIG[floor];

  if (!config) {
    throw new Error(
      `No FLOOR_CONFIG entry exists for Floor ${floor}.`,
    );
  }

  if (spacesById.has(spaceId)) {
    throw new Error(`Duplicate spaceId: ${spaceId}`);
  }

  const space = {
    id: spaceId,
    sourceRow: integer(
      row.sourceRow,
      `${spaceId} → sourceRow`,
    ),
    floor,
    roomNo: required(
      row.roomNo,
      `${spaceId} → roomNo`,
    ),
    spaceType: required(
      row.spaceType,
      `${spaceId} → spaceType`,
    ),
    displayName:
      String(row.displayName ?? "").trim() ||
      `${row.roomNo} - ${row.spaceType}`,
    regionId: nullableText(row.regionId),
    status: "not_inspected",
    polygon: [],
    daylightZone: nullableText(row.daylightZone),
    emergencyFixtures: nullableText(
      row.emergencyFixtures,
    ),
    testedBy: "",
    testedAt: null,
    notes: String(row.spaceNotes ?? "").trim(),
    items: [],
    issueIds: [],
  };

  spacesById.set(spaceId, space);

  const ids = spaceIdsByFloor.get(floor) ?? [];
  ids.push(spaceId);
  spaceIdsByFloor.set(floor, ids);
}

const seenItemKeys = new Set();

for (const row of itemRows) {
  const floor = required(
    row.floor,
    "space-items.csv → floor",
  );
  const spaceId = required(
    row.spaceId,
    "space-items.csv → spaceId",
  );
  const itemId = required(
    row.itemId,
    `${spaceId} → itemId`,
  );
  const deviceType = required(
    row.deviceType,
    `${spaceId}/${itemId} → deviceType`,
  );

  const space = spacesById.get(spaceId);

  if (!space) {
    throw new Error(
      `space-items.csv references unknown spaceId: ${spaceId}`,
    );
  }

  if (space.floor !== floor) {
    throw new Error(
      `${spaceId}/${itemId} says Floor ${floor}, ` +
        `but the space is on Floor ${space.floor}.`,
    );
  }

  const itemKey = uniqueKey([spaceId, itemId]);

  if (seenItemKeys.has(itemKey)) {
    throw new Error(
      `Duplicate itemId "${itemId}" in space "${spaceId}".`,
    );
  }

  seenItemKeys.add(itemKey);

  const catalog = catalogByDeviceType.get(deviceType);

  if (!catalog) {
    throw new Error(
      `Device type "${deviceType}" is missing from device-catalog.csv.`,
    );
  }

  const templateKey =
    String(row.testTemplateOverride ?? "").trim() ||
    catalog.defaultTestTemplate;

  const tests = testsByTemplate.get(templateKey);

  if (!tests) {
    throw new Error(
      `${spaceId}/${itemId} references unknown test template: ${templateKey}`,
    );
  }

  const expectedQty = nullableNumber(
    row.expectedQty,
    `${spaceId}/${itemId} → expectedQty`,
  );

  if (expectedQty !== null && expectedQty < 0) {
    throw new Error(
      `${spaceId}/${itemId} → expectedQty cannot be negative.`,
    );
  }

  space.items.push({
    id: itemId,
    category: catalog.category,
    deviceType,
    expectedQty,
    observedQty: null,
    result: "not_checked",
    notes:
      String(row.itemNotesOverride ?? "").trim() ||
      catalog.description,
    tests: structuredClone(tests),
    issueIds: [],
  });
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

for (const [floor, spaceIds] of spaceIdsByFloor) {
  const config = FLOOR_CONFIG[floor];

  const spaces = spaceIds
    .map((spaceId) => spacesById.get(spaceId))
    .sort(
      (a, b) =>
        a.sourceRow - b.sourceRow ||
        a.displayName.localeCompare(b.displayName),
    );

  const output = {
    schemaVersion: 1,
    floor,
    plan: {
      file: config.planFile,
      viewBox: config.viewBox,
    },
    spaces,
  };

  const outputPath = path.join(
    OUTPUT_DIR,
    `floor-${floor}-spaces.json`,
  );

  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );

  console.log(
    `Created ${path.relative(ROOT, outputPath)} ` +
      `(${spaces.length} spaces, ` +
      `${spaces.reduce((sum, space) => sum + space.items.length, 0)} items)`,
  );
}
