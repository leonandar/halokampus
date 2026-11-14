import { buildMockPmb } from "./app.js";

const port = Number(process.env.MOCK_PMB_PORT ?? 4100);
buildMockPmb()
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`[mock-pmb] DUMMY PMB API listening on :${port}`));
