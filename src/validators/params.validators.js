// validators/params.validators.js
import { z } from "zod";
export const ApplicationParams = z.object({
  applicationId: z.string().min(1),
});
