"use server";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { safePath } from "@/lib/redirect";
import { str, type ActionState } from "@/lib/form";
export async function saveNameAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const name = str(form, "name");
  if (!name || name.length > 80) return { error: "Enter a name up to 80 characters." };
  await (await clerkClient()).users.updateUser(userId, { firstName: name });
  revalidatePath("/", "layout");
  redirect(safePath(str(form, "next")));
}
