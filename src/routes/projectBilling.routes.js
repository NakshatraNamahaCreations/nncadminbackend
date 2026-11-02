import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { requireModule } from "../middleware/requireModule.js";
import {
  listExtras, createExtra, updateExtra, deleteExtra, addExtraPayment, deleteExtraPayment,
  listServices, createService, updateService, deleteService, addServicePayment, deleteServicePayment,
} from "../controllers/projectBilling.controller.js";

// Billing after the original deal — same access as Projects ("all-leads")
const canView = requireModule("all-leads", "view");
const canEdit = requireModule("all-leads", "edit");

export const projectExtraRoutes = express.Router();
projectExtraRoutes.use(protect);
projectExtraRoutes.get("/",                             canView, listExtras);
projectExtraRoutes.post("/",                            canEdit, createExtra);
projectExtraRoutes.put("/:id",                          canEdit, updateExtra);
projectExtraRoutes.delete("/:id",                       canEdit, deleteExtra);
projectExtraRoutes.post("/:id/payments",                canEdit, addExtraPayment);
projectExtraRoutes.delete("/:id/payments/:paymentId",   canEdit, deleteExtraPayment);

export const recurringServiceRoutes = express.Router();
recurringServiceRoutes.use(protect);
recurringServiceRoutes.get("/",                           canView, listServices);
recurringServiceRoutes.post("/",                          canEdit, createService);
recurringServiceRoutes.put("/:id",                        canEdit, updateService);
recurringServiceRoutes.delete("/:id",                     canEdit, deleteService);
recurringServiceRoutes.post("/:id/payments",              canEdit, addServicePayment);
recurringServiceRoutes.delete("/:id/payments/:paymentId", canEdit, deleteServicePayment);
