import { redirect } from "next/navigation";

// La redirección la hace next.config.ts (307 antes de pintar nada); esto solo queda por si se quita de allí.
export default function AdminIndexPage() {
  redirect("/admin/users");
}
