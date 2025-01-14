//@ts-ignore
import Copy from "@apexearth/copy";
import fs from "fs";
// @ts-ignore
import { addSerializer } from "jest-specific-snapshot";
import path from "path";
// @ts-ignore
import tempy from "tempy";
import { getCustomImportPath } from "../../utils/getCustomImportPath";
import { runTransform } from "../../utils/runner";
import { serializer } from "./snapshotSerializer";

// @ts-ignore
import("jest-specific-snapshot");

addSerializer(serializer);

const SNAPSHOT_DIR = path.join(__dirname, "..", "__snapshots__");
const FIXTURES_DIR = path.join(__dirname, "..", "__fixtures__");

async function run(
  transformer: string,
  filePath: string,
  flags?: { instanceNames: string }
) {
  let result = "";
  const baseOptions = {
    projectDir: filePath,
    customImportPath: process.env.PRISMA_CUSTOM_IMPORT_PATH,
    flags: {
      dry: false,
      print: false,
      runInBand: true,
      instanceNames: flags?.instanceNames,
    },
    testMode: true,
  };
  if (transformer === "update-2.12") {
    const namespace = await runTransform({
      transformer: "namespace",
      ...baseOptions,
    });
    const findUnique = await runTransform({
      transformer: "findUnique",

      ...baseOptions,
    });
    const to$ = await runTransform({
      transformer: "to$",
      ...baseOptions,
    });
    result = [namespace.stdout, findUnique.stdout].join("\n");
  } else {
    const trans = await runTransform({
      transformer,
      ...baseOptions,
    });
    result = trans.stdout;
  }
  return result;
}
const getAllFiles = function (dirPath: string, arrayOfFiles: string[] = []) {
  let files = fs.readdirSync(dirPath);

  arrayOfFiles = arrayOfFiles ?? [];
  const notCustom = (f: string) =>
    process.env.PRISMA_CUSTOM_IMPORT_PATH
      ? !f.includes(process.env.PRISMA_CUSTOM_IMPORT_PATH)
      : true;
  files.forEach(function (file) {
    const filepath = path.join(dirPath, "/", file);
    if (!filepath.includes("node_modules") && notCustom(filepath)) {
      if (fs.statSync(dirPath + "/" + file).isDirectory()) {
        arrayOfFiles = getAllFiles(filepath, arrayOfFiles);
      } else {
        arrayOfFiles.push(filepath);
      }
    }
  });

  return arrayOfFiles;
};
async function copy(from: string, to: string) {
  return new Promise<void>((resolve, reject) => {
    Copy({
      from, // Source copy path.
      to, // Destination copy path.
      recursive: true, // Copy recursively.
    })
      .then(() => resolve())
      .catch((err: Error) => reject(err));
  });
}
export async function buildTest(transformer: string) {
  const transformerFixtures = path.join(FIXTURES_DIR, transformer);

  const inputsDir = path.join(transformerFixtures, "inputs");
  const projectsDir = path.join(transformerFixtures, "projects");

  if (fs.existsSync(inputsDir)) {
    describe(`${transformer} inputs`, () => {
      const files = fs.readdirSync(inputsDir);
      for (const file of files) {
        const inputFilename = path.basename(file)
        test(inputFilename, async () => {
          const filePathFixed = path.join(inputsDir, file);
          const filePath = tempy.writeSync(
            fs.readFileSync(filePathFixed, { encoding: "utf8" })
          );
          if (inputFilename.includes("instanceNames")) {
            await run(transformer, filePath, {
              instanceNames: "whatEverYouWant,another",
            });
          } else {
            await run(transformer, filePath);
          }
          const snapshotFile = path.join(
            SNAPSHOT_DIR,
            transformer,
            "input",
            file
          );
          const result = fs.readFileSync(filePath, { encoding: "utf8" });
          // @ts-ignore
          expect(result).toMatchSpecificSnapshot(snapshotFile);
        });
      }
    });
  }
  if (fs.existsSync(projectsDir)) {
    describe(`${transformer} projects`, () => {
      const projects = fs.readdirSync(projectsDir);
      for (const projectName of projects) {
        test(projectName, async () => {
          const projectFixedDir = path.join(projectsDir, projectName);
          const projectDir = tempy.directory();

          await copy(projectFixedDir, projectDir);

          try {
            process.env.PRISMA_CUSTOM_IMPORT_PATH = await getCustomImportPath({
              cwd: projectDir,
            });
          } catch (err) {
            if (projectName.startsWith("throw")) {
              expect(err).toMatchSnapshot();
            }
          }
          await run(transformer, projectDir);

          const files = getAllFiles(projectDir);
          files.forEach((file) => {
            const snapshotFile = path.join(
              SNAPSHOT_DIR,
              transformer,
              "projects",
              projectName,
              path.relative(projectDir, file) + ".ssnap"
            );
            const result = fs.readFileSync(file, { encoding: "utf8" });
            // @ts-ignore
            expect(result).toMatchSpecificSnapshot(snapshotFile);
          });
        });
      }
    });
  }
}
