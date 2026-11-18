#!/usr/bin/env node
import { main } from "../server/src/main.js";

await main(process.argv.slice(2));
