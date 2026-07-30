import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useStore, TAIZ_DIRECTORATES } from "@/lib/store";
import type { MeterType } from "@/lib/pricing";
import { getGeoFix } from "@/lib/geolocation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Trash2, Droplets, ShieldCheck, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/customers")({
  head: () => ({ meta: [{ title: "المشتركون — ميزان" }, { name: "description", content: "الإدارة الموحّدة للمشتركين والعدادات." }] }),
  component: CustomersPage,
});

interface Form {
  name: string;
  phone: string;
  directorate: string;
  address: string;
  meterType: MeterType;
  meterNumber: string;
  familyMembers: number;
  latitude?: number;
  longitude?: number;
  geoAccuracy?: number;
}
const EMPTY: Form = { name: "", phone: "", directorate: TAIZ_DIRECTORATES[0], address: "", meterType: "water", meterNumber: "", familyMembers: 5 };

function CustomersPage() {
  const { customers, meters, adminCreateSubscriber, deleteCustomer } = useStore();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [geoBusy, setGeoBusy] = useState(false);

  async function captureLocation() {
    setGeoBusy(true);
    try {
      const fix = await getGeoFix();
      setForm((f) => ({ ...f, latitude: fix.lat, longitude: fix.lng, geoAccuracy: fix.accuracy }));
      toast.success(`تم تسجيل الموقع (±${Math.round(fix.accuracy)}م)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر تسجيل الموقع");
    } finally {
      setGeoBusy(false);
    }
  }

  const filtered = customers.filter((c) =>
    `${c.name} ${c.phone} ${c.directorate ?? ""} ${c.address ?? ""}`.toLowerCase().includes(q.toLowerCase()),
  );

  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.name.trim()) return toast.error("الاسم مطلوب");
    if (!form.phone.trim()) return toast.error("الهاتف مطلوب");
    if (!form.directorate.trim()) return toast.error("المديرية مطلوبة");
    if (!form.address.trim()) return toast.error("العنوان التفصيلي مطلوب");
    if (!form.meterNumber.trim()) return toast.error("رقم العداد الجديد مطلوب");
    if (meters.some((m) => m.number.toLowerCase() === form.meterNumber.trim().toLowerCase())) {
      return toast.error("رقم العداد مستخدم مسبقاً");
    }
    setSaving(true);
    try {
      await adminCreateSubscriber({
        name: form.name.trim(),
        phone: form.phone.trim(),
        directorate: form.directorate,
        address: form.address.trim(),
        meterType: form.meterType,
        meterNumber: form.meterNumber.trim(),
        familyMembers: Math.max(1, Number(form.familyMembers) || 1),
        latitude: form.latitude,
        longitude: form.longitude,
        geoAccuracy: form.geoAccuracy,
      });
      setForm(EMPTY);
      setOpen(false);
      toast.success("تم حفظ المشترك في قاعدة البيانات وتفعيل العداد");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر حفظ المشترك");
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">المشتركون</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            إدارة موحّدة — الإنشاء صلاحية إدارية حصرية ({customers.length})
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 ms-1" /> إضافة مشترك جديد</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>مشترك جديد — نموذج موحّد</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>الاسم الكامل *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <Label>الهاتف *</Label>
                  <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>المديرية *</Label>
                <Select value={form.directorate} onValueChange={(v) => setForm({ ...form, directorate: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TAIZ_DIRECTORATES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>العنوان التفصيلي *</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="الحارة، الشارع، أقرب معلم…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>رقم عداد المياه الجديد *</Label>
                  <Input dir="ltr" value={form.meterNumber} onChange={(e) => setForm({ ...form, meterNumber: e.target.value })} placeholder="مثال: W-1042" />
                </div>
                <div>
                  <Label>عدد أفراد الأسرة *</Label>
                  <Input
                    dir="ltr" type="number" min={1} value={form.familyMembers}
                    onChange={(e) => setForm({ ...form, familyMembers: Number(e.target.value) || 1 })}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">يُستخدم لحساب نصيب الفرد اليومي (استدامة).</p>
                </div>
              </div>

              <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1">
                    <MapPin className="w-4 h-4 text-primary" />
                    موقع العداد الجغرافي (GPS)
                  </Label>
                  <Button type="button" size="sm" variant="secondary" onClick={captureLocation} disabled={geoBusy}>
                    {geoBusy ? <Loader2 className="w-4 h-4 animate-spin ms-1" /> : <MapPin className="w-4 h-4 ms-1" />}
                    {form.latitude != null ? "إعادة تسجيل" : "تسجيل الموقع"}
                  </Button>
                </div>
                {form.latitude != null && form.longitude != null ? (
                  <p className="text-xs font-mono text-right" dir="ltr">
                    {form.latitude.toFixed(6)}, {form.longitude.toFixed(6)}
                    {form.geoAccuracy != null && ` · ±${Math.round(form.geoAccuracy)}m`}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">اختياري — يُربط المشترك بموقعه لتسهيل التحقق الميداني.</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ…" : "حفظ وتفعيل"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-4">
            <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground" />
            <Input className="ps-9" placeholder="بحث بالاسم، الهاتف، المديرية…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">#</TableHead>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right">الهاتف</TableHead>
                  <TableHead className="text-right">المديرية</TableHead>
                  <TableHead className="text-right">العنوان</TableHead>
                  <TableHead className="text-right">أفراد الأسرة</TableHead>
                  <TableHead className="text-right">العدادات</TableHead>

                  <TableHead className="text-right">حساب السداد</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => {
                  const cMeters = meters.filter((m) => m.customer_id === c.id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="text-muted-foreground">{c.id}</TableCell>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell dir="ltr" className="text-right">{c.phone}</TableCell>
                      <TableCell>{c.directorate ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[220px] truncate">{c.address ?? "—"}</TableCell>
                      <TableCell>{c.family_members ?? "—"}</TableCell>

                      <TableCell>
                        <div className="flex gap-1 flex-wrap">
                          {cMeters.map((m) => (
                            <Badge key={m.id} variant="outline" className="gap-1">
                              <Droplets className="w-3 h-3 text-water" />
                              {m.number}
                            </Badge>
                          ))}
                          {cMeters.length === 0 && <span className="text-xs text-muted-foreground">لا يوجد</span>}
                        </div>
                      </TableCell>
                      <TableCell dir="ltr" className="font-mono text-[11px] text-right">{c.pay_account}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => { if (confirm("حذف المشترك وكل عداداته؟")) { deleteCustomer(c.id); toast.success("تم الحذف"); } }}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
