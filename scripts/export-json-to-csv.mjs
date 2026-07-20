import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const ROOT = process.cwd();
const INPUT_DIR = path.join(ROOT, "public", "data");
const OUTPUT_DIR = path.join(ROOT, "data-source");

const JSON_FILES = [
  "floor-03-spaces.json",
  "floor-04-spaces.json",
];

const TEMPLATE_BY_DEVICE = {
  X1: "exit-sign",
  Sc3: "scene-controller",
  S4b: "wall-dimmer",
  "SCPPH-1500": "photosensor",
};

function writeCsv(filename, rows, columns) {
  const outputPath = path.join(OUTPUT_DIR, filename);
  const csvText = Papa.unparse(rows, {
    columns,
    newline: "\n",
  });

  fs.writeFileSync(outputPath, `\uFEFF${csvText}\n`, "utf8");
  console.log(`Created ${path.relative(ROOT, outputPath)}`);
}

const spaces = [];
const items = [];
const devices = new Map();

for (const filename of JSON_FILES) {
  const inputPath = path.join(INPUT_DIR, filename);

  if (!fs.existsSync(inputPath)) {
    console.warn(`Skipped missing file: ${path.relative(ROOT, inputPath)}`);
    continue;
  }

  const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));

  if (!Array.isArray(data.spaces)) {
    throw new Error(`${filename} does not contain a spaces array.`);
  }

  for (const space of data.spaces) {
    spaces.push({
      floor: space.floor ?? data.floor ?? "",
      sourceRow: space.sourceRow ?? "",
      spaceId: space.id ?? "",
      roomNo: space.roomNo ?? "",
      spaceType: space.spaceType ?? "",
      displayName: space.displayName ?? "",
      regionId: space.regionId ?? "",
      spaceNotes: space.notes ?? "",
      daylightZone: space.daylightZone ?? "",
      emergencyFixtures: space.emergencyFixtures ?? "",
    });

    for (const item of space.items ?? []) {
      items.push({
        floor: space.floor ?? data.floor ?? "",
        spaceId: space.id ?? "",
        itemId: item.id ?? "",
        deviceType: item.deviceType ?? "",
        expectedQty: item.expectedQty ?? "",
        itemNotesOverride: "",
        testTemplateOverride: "",
      });

      const existing = devices.get(item.deviceType);

      if (
        existing &&
        (existing.category !== item.category ||
          existing.description !== (item.notes ?? ""))
      ) {
        console.warn(
          `Device ${item.deviceType} has inconsistent category or notes. ` +
            `The first value will be used in device-catalog.csv. ` +
            `Put space-specific wording in itemNotesOverride if needed.`,
        );
        continue;
      }

      if (!existing) {
        devices.set(item.deviceType, {
          deviceType: item.deviceType ?? "",
          category: item.category ?? "",
          description: item.notes ?? "",
          defaultTestTemplate:
            TEMPLATE_BY_DEVICE[item.deviceType] ??
            (item.category === "lighting"
              ? "lighting-standard"
              : "control-standard"),
        });
      }
    }
  }
}

if (spaces.length === 0) {
  throw new Error(
    "No spaces were found. Confirm the JSON files exist under public/data.",
  );
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

spaces.sort(
  (a, b) =>
    String(a.floor).localeCompare(String(b.floor)) ||
    Number(a.sourceRow || 0) - Number(b.sourceRow || 0),
);

items.sort(
  (a, b) =>
    String(a.floor).localeCompare(String(b.floor)) ||
    String(a.spaceId).localeCompare(String(b.spaceId)) ||
    String(a.itemId).localeCompare(String(b.itemId)),
);

writeCsv("spaces.csv", spaces, [
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

writeCsv("space-items.csv", items, [
  "floor",
  "spaceId",
  "itemId",
  "deviceType",
  "expectedQty",
  "itemNotesOverride",
  "testTemplateOverride",
]);

writeCsv(
  "device-catalog.csv",
  [...devices.values()].sort((a, b) =>
    String(a.deviceType).localeCompare(String(b.deviceType)),
  ),
  [
    "deviceType",
    "category",
    "description",
    "defaultTestTemplate",
  ],
);

console.log(
  "\nReview device-catalog.csv before building JSON, especially device types " +
    "that currently use the generic control-standard template.",
);
