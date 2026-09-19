export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      memoranda_files: {
        Row: {
          id: string;
          owner_id: string | null;
          unit_id: string;
          file_name: string;
          storage_path: string;
          file_size: number;
          checksum: string;
          mime_type: string;
          is_bundled: boolean;
          revision: number;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['memoranda_files']['Row'], 'id' | 'created_at' | 'updated_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['memoranda_files']['Insert']>;
        Relationships: [];
      };
      app_settings: {
        Row: {
          id: string;
          owner_id: string;
          settings: Json;
          revision: number;
          updated_by_device: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['app_settings']['Row'], 'id' | 'created_at' | 'updated_at' | 'revision' | 'updated_by_device'> & {
          id?: string;
          revision?: number;
          updated_by_device?: string | null;
        };
        Update: Partial<Database['public']['Tables']['app_settings']['Insert']>;
        Relationships: [];
      };
      sync_conflicts: {
        Row: {
          id: string;
          owner_id: string;
          entity_type: string;
          entity_id: string | null;
          local_revision: number;
          remote_revision: number;
          local_device_id: string | null;
          remote_device_id: string | null;
          resolution: 'last-write-wins';
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['sync_conflicts']['Row'], 'id' | 'created_at'> & { id?: string };
        Update: Partial<Database['public']['Tables']['sync_conflicts']['Insert']>;
        Relationships: [];
      };
      sync_tombstones: {
        Row: {
          owner_id: string;
          entity_type: string;
          entity_id: string;
          deleted_at: string;
          revision: number;
          device_id: string | null;
        };
        Insert: Database['public']['Tables']['sync_tombstones']['Row'];
        Update: Partial<Database['public']['Tables']['sync_tombstones']['Insert']>;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          avatar_url: string | null;
          school_name: string | null;
          phone: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      classes: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          level: string | null;
          section: string | null;
          weekly_hours: number;
          academic_year: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
          sync_revision: number;
          sync_updated_at: string;
          sync_device_id: string | null;
        };
        Insert: Omit<Database['public']['Tables']['classes']['Row'], 'id' | 'created_at' | 'updated_at' | 'sync_revision' | 'sync_updated_at' | 'sync_device_id'> & {
          id?: string;
          sync_revision?: number;
          sync_updated_at?: string;
          sync_device_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['classes']['Insert']>;
        Relationships: [];
      };
      students: {
        Row: {
          id: string;
          owner_id: string;
          class_id: string;
          external_id: string | null;
          full_name: string;
          normalized_name: string;
          number_in_list: number;
          reg_number: string | null;
          registration_number: string | null;
          is_repeater: boolean;
          guardian_phone: string | null;
          gender: string | null;
          birth_date: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
          sync_revision: number;
          sync_updated_at: string;
          sync_device_id: string | null;
        };
        Insert: Omit<Database['public']['Tables']['students']['Row'], 'id' | 'normalized_name' | 'created_at' | 'updated_at' | 'sync_revision' | 'sync_updated_at' | 'sync_device_id'> & {
          id?: string;
          sync_revision?: number;
          sync_updated_at?: string;
          sync_device_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['students']['Insert']>;
        Relationships: [];
      };
      grades: {
        Row: {
          id: string;
          owner_id: string;
          student_id: string;
          class_id: string;
          trimester: 1 | 2 | 3;
          continuous_eval: number | null;
          behavior_score: number | null;
          attendance_score: number | null;
          notebook_score: number | null;
          participation_score: number | null;
          quiz: number | null;
          exam: number | null;
          calculated_average: number | null;
          estimation: string | null;
          guidance: string | null;
          remarks: string | null;
          follow_up_notes: string | null;
          created_at: string;
          updated_at: string;
          sync_revision: number;
          sync_updated_at: string;
          sync_device_id: string | null;
        };
        Insert: Omit<Database['public']['Tables']['grades']['Row'], 'id' | 'created_at' | 'updated_at' | 'sync_revision' | 'sync_updated_at' | 'sync_device_id'> & {
          id?: string;
          sync_revision?: number;
          sync_updated_at?: string;
          sync_device_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['grades']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      reset_workspace: {
        Args: Record<string, never>;
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
