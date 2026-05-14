import React, { useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { motion } from 'framer-motion';
import { Upload, Save, Image as ImageIcon, RotateCw } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/customSupabaseClient';

const SystemSettings = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState({
    systemName: '',
    logoUrl: '',
    currency: '',
    attendanceMinMeetingsForIncreaseEligibility: '6',
    attendanceRequireNoDefaultForAutoIncrease: 'true',
  });
  const [logoPreview, setLogoPreview] = useState('');
  const [newLogoFile, setNewLogoFile] = useState(null);
  const fileInputRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    const { data, error } = await supabase.from('system_config').select('*');
    if (error) {
      toast({ variant: "destructive", title: "Error fetching settings", description: error.message });
    } else {
      const dbConfig = data.reduce((acc, item) => {
        acc[item.key] = item.value;
        return acc;
      }, {});
      const fetchedConfig = {
        systemName: dbConfig.systemName || 'Mukwano Loans',
        logoUrl: dbConfig.logoUrl || '',
        currency: dbConfig.currency || 'TZS',
        attendanceMinMeetingsForIncreaseEligibility:
          dbConfig.attendanceMinMeetingsForIncreaseEligibility || '6',
        attendanceRequireNoDefaultForAutoIncrease:
          dbConfig.attendanceRequireNoDefaultForAutoIncrease === 'false' ? 'false' : 'true',
      };
      setConfig(fetchedConfig);
      setLogoPreview(fetchedConfig.logoUrl);
    }
    setIsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setConfig(prev => ({ ...prev, [name]: value }));
  };
  
  const handleLogoUploadClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setNewLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadLogo = async () => {
    if (!newLogoFile) return config.logoUrl;

    const fileExt = newLogoFile.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `public/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('logos')
      .upload(filePath, newLogoFile);

    if (uploadError) {
      throw new Error(`Logo upload failed: ${uploadError.message}`);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('logos')
      .getPublicUrl(filePath);
      
    return publicUrl;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      let newLogoUrl = config.logoUrl;
      if (newLogoFile) {
          newLogoUrl = await uploadLogo();
      }

      const updatedConfig = {
        ...config,
        logoUrl: newLogoUrl,
      };
      
      const updates = Object.entries(updatedConfig).map(([key, value]) => ({
        key,
        value,
      }));

      for (const item of updates) {
        const { error } = await supabase.from('system_config').upsert(item, { onConflict: 'key' });
        if (error) throw error;
      }
      
      setConfig(updatedConfig);
      setNewLogoFile(null);

      toast({
        title: 'Success!',
        description: 'System settings have been saved. Reloading to apply changes...',
      });

      setTimeout(() => window.location.reload(), 2000);

    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Save Failed',
        description: error.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <DashboardLayout title="System Settings">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <form onSubmit={handleSave} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Branding & Configuration</CardTitle>
              <CardDescription>Manage your system's identity and basic settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {isLoading ? (
                 <div className="flex items-center justify-center p-8">
                    <RotateCw className="h-6 w-6 animate-spin text-gray-500" />
                    <span className="ml-2">Loading settings...</span>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="systemName">System Name</Label>
                    <Input
                      id="systemName"
                      name="systemName"
                      value={config.systemName}
                      onChange={handleInputChange}
                      placeholder="e.g., Mukwano Loans"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>System Logo</Label>
                     <div className="flex items-center space-x-4">
                      <div className="h-16 w-16 flex items-center justify-center rounded-md bg-gray-100 p-1 border">
                        {logoPreview ? (
                          <img src={logoPreview} alt="Logo Preview" className="h-full w-full object-contain" />
                        ) : (
                          <ImageIcon className="h-8 w-8 text-gray-400" />
                        )}
                      </div>
                      <Input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/png, image/jpeg, image/svg+xml" />
                      <Button type="button" variant="outline" onClick={handleLogoUploadClick}>
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Logo
                      </Button>
                    </div>
                     <p className="text-xs text-gray-500 mt-1">Recommended size: 256x256px, PNG, JPG or SVG format.</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="currency">Default Currency</Label>
                    <Input
                      id="currency"
                      name="currency"
                      value={config.currency}
                      onChange={handleInputChange}
                      placeholder="e.g., TZS, USD"
                    />
                  </div>

                  <div className="rounded-lg border border-border/80 bg-muted/30 p-4 space-y-4">
                    <div>
                      <p className="text-sm font-medium">Centre attendance</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Thresholds for counting meetings attended (reference for reporting; extend later for loan rules).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="attendanceMinMeetingsForIncreaseEligibility">
                        Minimum meetings marked Present (reference)
                      </Label>
                      <Input
                        id="attendanceMinMeetingsForIncreaseEligibility"
                        name="attendanceMinMeetingsForIncreaseEligibility"
                        type="number"
                        min={0}
                        max={999}
                        value={config.attendanceMinMeetingsForIncreaseEligibility}
                        onChange={handleInputChange}
                      />
                    </div>
                    <div className="flex items-start gap-3 space-y-0">
                      <Checkbox
                        id="attendanceRequireNoDefaultForAutoIncrease"
                        checked={config.attendanceRequireNoDefaultForAutoIncrease === 'true'}
                        onCheckedChange={(checked) =>
                          setConfig((prev) => ({
                            ...prev,
                            attendanceRequireNoDefaultForAutoIncrease: checked === true ? 'true' : 'false',
                          }))
                        }
                      />
                      <div className="grid gap-1.5 leading-none">
                        <Label htmlFor="attendanceRequireNoDefaultForAutoIncrease" className="cursor-pointer font-normal">
                          Require no defaulted loan for attendance reference eligibility
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Stored for future automation; attendance recording works regardless.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div className="flex justify-end pt-4">
                 <Button type="submit" disabled={isLoading || isSaving}>
                    {isSaving ? (
                      <>
                        <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save Settings
                      </>
                    )}
                 </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </motion.div>
    </DashboardLayout>
  );
};

export default SystemSettings;