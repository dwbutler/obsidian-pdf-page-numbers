import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.argv[2];
if (!targetVersion) {
	console.error("Usage: node version-bump.mjs <version>");
	process.exit(1);
}

// Update manifest.json
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t") + "\n");

// Update package.json
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = targetVersion;
writeFileSync("package.json", JSON.stringify(pkg, null, "\t") + "\n");

console.log(`Bumped version to ${targetVersion}`);
