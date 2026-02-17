import app from "./app.js";
import { config } from "./config.js";

app.listen(config.port, () => {
  console.log(`Server listening on http://0.0.0.0:${config.port}`);
});
