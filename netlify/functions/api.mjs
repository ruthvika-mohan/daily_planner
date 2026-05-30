import "dotenv/config";
import serverless from "serverless-http";
import { createApp } from "../../server/app.js";

export const handler = serverless(createApp());
