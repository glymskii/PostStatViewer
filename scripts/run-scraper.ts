import { config } from "dotenv";
config({ path: ".env.local" });
import { runScrapeForAllAccounts } from "../src/scraper/runner";

async function main() {
  console.log("Starting manual scrape...");
  await runScrapeForAllAccounts();
  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
