import mongoose from "mongoose";
import dotenv from "dotenv";
import TodayPlanTask from "../models/TodayPlanTask.js";

dotenv.config();

const seedTodayPlan = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    const today = new Date();
    today.setHours(10, 0, 0, 0);

    await TodayPlanTask.deleteMany({
      plannedDate: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lte: new Date(new Date().setHours(23, 59, 59, 999)),
      },
    });

    await TodayPlanTask.insertMany([
      {
        title: "Arjun's Dental",
        taskType: "new_call",
        priority: "urgent",
        status: "pending",
        section: "call_immediately",
        dueLabel: "ASAP",
        subtitle: "New lead — call within 5 minutes of enquiry",
        city: "Bangalore",
        ownerName: "Arjun S",
        source: "Website",
        service: "Website Design",
        phone: "9876543210",
        plannedDate: today,
        sortOrder: 1,
      },
      {
        title: "Sunita Bakery",
        taskType: "new_call",
        priority: "urgent",
        status: "pending",
        section: "call_immediately",
        dueLabel: "ASAP",
        subtitle: "New lead — call within 5 minutes of enquiry",
        city: "Mumbai",
        ownerName: "Karthik R",
        source: "Google Ads",
        service: "Website Design",
        phone: "9876543211",
        plannedDate: today,
        sortOrder: 2,
      },
      {
        title: "Green Fields Farm",
        taskType: "new_call",
        priority: "urgent",
        status: "pending",
        section: "call_immediately",
        dueLabel: "ASAP",
        subtitle: "New lead — call within 5 minutes of enquiry",
        city: "Chennai",
        ownerName: "Dev",
        source: "Referral",
        service: "CRM Setup",
        phone: "9876543212",
        plannedDate: today,
        sortOrder: 3,
      },
      {
        title: "Ravi Kumar Foods",
        taskType: "payment",
        priority: "medium",
        status: "pending",
        section: "other",
        dueLabel: "11:00 AM",
        subtitle: "Follow up on pending payment",
        city: "Hyderabad",
        ownerName: "Meena",
        source: "Existing Client",
        service: "Payment Collection",
        phone: "9876543213",
        plannedDate: today,
        sortOrder: 4,
      },
      {
        title: "Cloud Tech Pvt Ltd",
        taskType: "proposal",
        priority: "medium",
        status: "pending",
        section: "other",
        dueLabel: "1:30 PM",
        subtitle: "Send proposal after discussion",
        city: "Pune",
        ownerName: "Harish",
        source: "LinkedIn",
        service: "CRM Development",
        phone: "9876543214",
        plannedDate: today,
        sortOrder: 5,
      },
      {
        title: "Nova Traders",
        taskType: "meeting",
        priority: "low",
        status: "pending",
        section: "other",
        dueLabel: "4:00 PM",
        subtitle: "Product demo meeting",
        city: "Delhi",
        ownerName: "Anand",
        source: "Website",
        service: "Admin Panel Demo",
        phone: "9876543215",
        plannedDate: today,
        sortOrder: 6,
      },
    ]);

    console.log("Today plan seeded successfully");
    process.exit(0);
  } catch (error) {
    console.error("seedTodayPlan error:", error);
    process.exit(1);
  }
};

seedTodayPlan();