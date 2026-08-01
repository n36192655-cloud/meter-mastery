import React, { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MeterCamera } from "@/components/meter-camera";
import { calculateBill } from "@/lib/tariff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertTriangle, Calculator } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/readings")({
  component: ReadingsPage,
});

export default function ReadingsPage() {
  const queryClient = useQueryClient();

  // الحالات الخاصة بإدخال القراءة والصورة
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedMeterId, setSelectedMeterId] = useState<string>("");
  const [currentReadingInput, setCurrentReadingInput] = useState<string>("");
  const [readingDate, setReadingDate] = useState<string>(new Date().toISOString().split("T")[0]);
  
  // حفظ ملف الصورة المضغوط ورابط المعاينة والتنبيهات
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [uploadWarning, setUploadWarning] = useState<string | null>(null);

  // 1. جلب بيانات المستخدم الحالي ومؤسسته من profiles لضمان مسار الـ RLS الآمن
  const { data: userProfile } = useQuery({
    queryKey: ["current-user-profile"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from("profiles")
        .select("id, organization_id")
        .eq("id", user.id)
        .single();

      if (error) throw error;
      return data;
    },
  });

  // 2. جلب قائمة المشتركين
  const { data: customers = [], isLoading: isLoadingCustomers } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, full_name, account_number")
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // 3. جلب العدادات المرتبطة بالمشترك المحدد
  const { data: meters = [], isLoading: isLoadingMeters } = useQuery({
    queryKey: ["customer-meters", selectedCustomerId],
    enabled: !!selectedCustomerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("meters")
        .select("id, meter_number, last_reading, tariff_category")
        .eq("customer_id", selectedCustomerId);
      if (error) throw error;
      return data;
    },
  });

  const selectedMeter = meters.find((m) => m.id === selectedMeterId);
  const previousReading = selectedMeter ? selectedMeter.last_reading || 0 : 0;
  const currentReading = parseFloat(currentReadingInput) || 0;
  const consumption = Math.max(0, currentReading - previousReading);

  // حساب الفاتورة مسبقاً للعرض فقط في الواجهة باستخدام tariff.ts دون المساس بالمنطق
  const billCalculation = calculateBill(
    consumption,
    selectedMeter?.tariff_category || "residential"
  );

  // التعامل مع التقاط الصورة من مكون MeterCamera
  const handleCapture = (file: File, preview: string) => {
    setImageFile(file);
    setPreviewUrl(preview);
    setUploadWarning(null);
  };

  const handleClearImage = () => {
    setImageFile(null);
    setPreviewUrl("");
    setUploadWarning(null);
  };

  // دالة رفع الصورة إلى Private Supabase Storage Bucket وتخزين المسار الثابت النسبِي (filePath)
  const uploadImageToPrivateStorage = async (
    file: File,
    organizationId: string,
    meterId: string
  ): Promise<string | null> => {
    try {
      const fileExt = "jpg";
      const fileName = `meter_${Date.now()}.${fileExt}`;
      const filePath = `${organizationId}/${meterId}/${fileName}`;

      // رفع الصورة إلى الـ Private Bucket
      const { error: uploadError } = await supabase.storage
        .from("meter-readings")
        .upload(filePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: "image/jpeg",
        });

      if (uploadError) {
        console.warn("فشل رفع الصورة إلى Storage، سيتم الاستمرار بدون صورة:", uploadError);
        return null;
      }

      // تخزين المسار النظيف الثابت (filePath) داخل قاعدة البيانات لتوافق الـ Private Bucket
      return filePath;
    } catch (err) {
      console.warn("استثناء أثناء محاولة رفع الصورة:", err);
      return null;
    }
  };

  // طفرة حفظ القراءة وإصدار الفاتورة عبر RPC
  const submitReadingMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMeterId) throw new Error("يرجى اختيار العداد أولاً.");
      if (currentReading < previousReading) {
        throw new Error("القراءة الحالية لا يمكن أن تكون أقل من القراءة السابقة.");
      }

      let storedFilePath: string | null = null;
      let isImageUploadedSuccessfully = true;

      // محاولة رفع الصورة فقط إذا تم التقاطها ومعرف المؤسسة موجود
      if (imageFile && userProfile?.organization_id) {
        storedFilePath = await uploadImageToPrivateStorage(
          imageFile,
          userProfile.organization_id,
          selectedMeterId
        );

        if (!storedFilePath) {
          isImageUploadedSuccessfully = false;
        }
      }

      // 1. تسجيل سجل القراءة في جدول meter_readings
      const { data: readingData, error: readingError } = await supabase
        .from("meter_readings")
        .insert({
          meter_id: selectedMeterId,
          reading_date: readingDate,
          previous_reading: previousReading,
          current_reading: currentReading,
          consumption: consumption,
          image_url: storedFilePath,
        })
        .select()
        .single();

      if (readingError) throw readingError;

      // 2. تحديث القراءة الأخيرة للعداد في جدول meters
      const { error: meterUpdateError } = await supabase
        .from("meters")
        .update({ last_reading: currentReading })
        .eq("id", selectedMeterId);

      if (meterUpdateError) throw meterUpdateError;

      // 3. التحقق من عدم وجود فاتورة سابقة مرتبطة بهذه القراءة لمنع التكرار
      const { data: existingBill, error: checkBillError } = await supabase
        .from("bills")
        .select("id")
        .eq("reading_id", readingData.id)
        .maybeSingle();

      if (checkBillError) throw checkBillError;

      // 4. استدعاء RPC: issue_bill_for_reading في حال عدم وجود فاتورة مسبقة
      if (!existingBill) {
        const { error: rpcError } = await supabase.rpc("issue_bill_for_reading", {
          p_reading_id: readingData.id,
        });

        if (rpcError) {
          throw new Error(`فشل إصدار الفاتورة عبر RPC: ${rpcError.message}`);
        }
      }

      return { isImageUploadedSuccessfully, hadImage: !!imageFile };
    },
    onSuccess: (result) => {
      if (result.hadImage && !result.isImageUploadedSuccessfully) {
        setUploadWarning(
          "تم حفظ القراءة وإصدار الفاتورة بنجاح، ولكن تعذر رفع صورة العداد بسبب ضعف الاتصال بالشبكة."
        );
        toast.warning("تم تسجيل القراءة بدون رفع الصورة نظراً لضعف الاتصال.");
      } else {
        toast.success("تم تسجيل القراءة وإصدار الفاتورة بنجاح عبر النظام المالي!");
      }

      // إعادة ضبط الحقول وتحديث الاستعلامات
      setCurrentReadingInput("");
      setImageFile(null);
      setPreviewUrl("");
      queryClient.invalidateQueries({ queryKey: ["customer-meters"] });
      queryClient.invalidateQueries({ queryKey: ["customer-bills"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "حدث خطأ أثناء حفظ القراءة وإصدار الفاتورة.");
    },
  });

  return (
    <div className="container mx-auto p-4 max-w-4xl dir-rtl text-right" dir="rtl">
      <Card className="shadow-md border-border">
        <CardHeader>
          <CardTitle className="text-2xl font-bold flex items-center gap-2">
            <Calculator className="w-6 h-6 text-primary" />
            تسجيل قراءة العداد وإصدار الفاتورة
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-6">
          {uploadWarning && (
            <Alert variant="warning" className="bg-amber-50 text-amber-900 border-amber-200 dir-rtl">
              <AlertTriangle className="w-4 h-4 ml-2 text-amber-600" />
              <AlertDescription>{uploadWarning}</AlertDescription>
            </Alert>
          )}

          {/* اختيار المشترك والعداد */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="customer-select">اختيار المشترك</Label>
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger id="customer-select">
                  <SelectValue placeholder="اختر المشترك من القائمة..." />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingCustomers ? (
                    <SelectItem value="loading" disabled>جاري التحميل...</SelectItem>
                  ) : (
                    customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name} ({c.account_number})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="meter-select">اختيار العداد</Label>
              <Select
                value={selectedMeterId}
                onValueChange={setSelectedMeterId}
                disabled={!selectedCustomerId || isLoadingMeters}
              >
                <SelectTrigger id="meter-select">
                  <SelectValue placeholder={selectedCustomerId ? "اختر العداد..." : "اختر المشترك أولاً"} />
                </SelectTrigger>
                <SelectContent>
                  {meters.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      عداد رقم: {m.meter_number} (القراءة السابقة: {m.last_reading || 0})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* مدخلات القراءة والتاريخ */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>القراءة السابقة</Label>
              <Input value={previousReading} disabled className="bg-muted font-bold" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="current-reading">القراءة الحالية</Label>
              <Input
                id="current-reading"
                type="number"
                placeholder="أدخل القراءة الحالية"
                value={currentReadingInput}
                onChange={(e) => setCurrentReadingInput(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reading-date">تاريخ القراءة</Label>
              <Input
                id="reading-date"
                type="date"
                value={readingDate}
                onChange={(e) => setReadingDate(e.target.value)}
              />
            </div>
          </div>

          {/* مكون التقاط الصورة */}
          <div className="space-y-2 border-t pt-4">
            <Label>توثيق صورة العداد (ميدانياً)</Label>
            <MeterCamera
              onCapture={handleCapture}
              onClear={handleClearImage}
              initialPreview={previewUrl}
            />
          </div>

          {/* ملخص احتساب الفاتورة */}
          {selectedMeterId && currentReadingInput && (
            <div className="p-4 bg-muted/50 rounded-lg space-y-2 border">
              <div className="flex justify-between items-center text-sm">
                <span>كمية الاستهلاك:</span>
                <span className="font-bold">{consumption} م³</span>
              </div>
              <div className="flex justify-between items-center text-base font-bold text-primary">
                <span>إجمالي الفاتورة المتوقعة:</span>
                <span>{billCalculation.totalAmount.toLocaleString()} ريال</span>
              </div>
            </div>
          )}

          {/* زر الاعتماد والتسجيل */}
          <Button
            onClick={() => submitReadingMutation.mutate()}
            disabled={
              submitReadingMutation.isPending ||
              !selectedMeterId ||
              !currentReadingInput ||
              currentReading < previousReading
            }
            className="w-full gap-2 text-lg py-6"
          >
            {submitReadingMutation.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                جاري الحفظ وإصدار الفاتورة...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                تأكيد القراءة وإصدار الفاتورة
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
