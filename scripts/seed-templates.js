// scripts/seed-templates.js
// Auto-seed ALL JSON workflow templates into Supabase database table `workflow_templates`

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey || supabaseUrl.includes('your-project')) {
  console.error('\n❌ ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in .env to seed templates.\n');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

const TEMPLATE_FOLDER = path.join(__dirname, "../workflow-templates");

function getAllJsonFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      results = results.concat(getAllJsonFiles(fullPath));
    } else if (file.endsWith(".json")) {
      results.push(fullPath);
    }
  }

  return results;
}

function detectCategory(filePath, name) {
  const str = (filePath + ' ' + name).toLowerCase();
  if (str.includes("aws") || str.includes("ec2") || str.includes("s3") || str.includes("iam")) return "AWS Automation";
  if (str.includes("gcp") || str.includes("gcs") || str.includes("google") || str.includes("firebase")) return "Google Cloud Automation";
  if (str.includes("azure")) return "Azure Automation";
  if (str.includes("rag") || str.includes("ai")) return "AI Automation";
  if (str.includes("dropbox")) return "Storage Automation";
  return "General Automation";
}

async function seedAllTemplates() {
  console.log("\n🌱 Seeding ALL workflow templates into Supabase...\n");

  const jsonFiles = getAllJsonFiles(TEMPLATE_FOLDER);
  console.log(`📂 Found ${jsonFiles.length} workflow JSON files\n`);

  let count = 0;
  for (const filePath of jsonFiles) {
    try {
      const jsonRaw = fs.readFileSync(filePath, "utf8");
      const workflowJson = JSON.parse(jsonRaw);

      const name = workflowJson.name || path.basename(filePath, ".json");
      const template_id = path
        .basename(filePath)
        .replace(".json", "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

      const category = detectCategory(filePath, name);
      const nodeCount = workflowJson.nodes?.length || 0;

      console.log(`📦 Uploading: ${name}`);
      console.log(`   → Template ID: ${template_id}`);
      console.log(`   → Nodes: ${nodeCount}`);
      console.log(`   → Category: ${category}`);

      const { error } = await supabase
        .from("workflow_templates")
        .upsert(
          {
            template_id,
            name,
            description: `Imported workflow template with ${nodeCount} nodes.`,
            category,
            icon: "fa-bolt",
            template_json: workflowJson,
            required_credentials: [],
            config_fields: [],
            tags: [category.toLowerCase().split(' ')[0]],
            is_active: true,
          },
          { onConflict: "template_id" }
        );

      if (error) {
        console.log("   ❌ DB Error:", error.message);
      } else {
        console.log("   ✅ Seeded successfully!\n");
        count++;
      }
    } catch (err) {
      console.log("❌ Failed to parse:", filePath);
      console.log("   Reason:", err.message, "\n");
    }
  }

  console.log(`🎉 Finished! Successfully seeded ${count}/${jsonFiles.length} templates.`);
}

seedAllTemplates();
