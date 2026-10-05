export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      businesses: {
        Row: {
          id: string
          name: string
          owner_id: string
          onboarding_status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          owner_id: string
          onboarding_status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          owner_id?: string
          onboarding_status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "businesses_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      business_memberships: {
        Row: {
          id: string
          business_id: string
          user_id: string
          role: string
          created_at: string
        }
        Insert: {
          id?: string
          business_id: string
          user_id: string
          role: string
          created_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          user_id?: string
          role?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_memberships_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      branches: {
        Row: {
          id: string
          business_id: string
          name: string
          location: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          name: string
          location?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          name?: string
          location?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      devices: {
        Row: {
          id: string
          device_id: string
          business_id: string
          branch_id: string
          name: string
          type: string
          status: string
          last_seen: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          device_id: string
          business_id: string
          branch_id: string
          name: string
          type: string
          status?: string
          last_seen?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          device_id?: string
          business_id?: string
          branch_id?: string
          name?: string
          type?: string
          status?: string
          last_seen?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
      staff_members: {
        Row: {
          id: string
          business_id: string
          branch_id: string
          name: string
          role: string
          status: string
          pin_hash: string | null
          active_shift: boolean
          performance_score: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          branch_id: string
          name: string
          role: string
          status?: string
          pin_hash?: string | null
          active_shift?: boolean
          performance_score?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          branch_id?: string
          name?: string
          role?: string
          status?: string
          pin_hash?: string | null
          active_shift?: boolean
          performance_score?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_members_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
      catalog_products: {
        Row: {
          id: string
          business_id: string
          branch_id: string | null
          name: string
          category: string
          price: number
          description: string | null
          stock_quantity: number
          unit_of_measure: string
          cost_price: number | null
          status: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          branch_id?: string | null
          name: string
          category: string
          price: number
          description?: string | null
          stock_quantity?: number
          unit_of_measure: string
          cost_price?: number | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          branch_id?: string | null
          name?: string
          category?: string
          price?: number
          description?: string | null
          stock_quantity?: number
          unit_of_measure?: string
          cost_price?: number | null
          status?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_products_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
      orders: {
        Row: {
          id: string
          business_id: string
          branch_id: string
          device_id: string | null
          cashier_id: string | null
          cashier_name: string | null
          customer_name: string | null
          customer_phone: string | null
          subtotal: number
          tax: number
          total_amount: number
          status: string
          payment_method: string | null
          payment_status: string
          cash_tendered: number | null
          change_due: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          business_id: string
          branch_id: string
          device_id?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          subtotal: number
          tax?: number
          total_amount: number
          status: string
          payment_method?: string | null
          payment_status?: string
          cash_tendered?: number | null
          change_due?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          business_id?: string
          branch_id?: string
          device_id?: string | null
          cashier_id?: string | null
          cashier_name?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          subtotal?: number
          tax?: number
          total_amount?: number
          status?: string
          payment_method?: string | null
          payment_status?: string
          cash_tendered?: number | null
          change_due?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["device_id"]
          },
          {
            foreignKeyName: "orders_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "staff_members"
            referencedColumns: ["id"]
          }
        ]
      }
      order_items: {
        Row: {
          id: string
          order_id: string
          product_id: string | null
          name: string
          unit_price: number
          quantity: number
          line_total: number
          notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          order_id: string
          product_id?: string | null
          name: string
          unit_price: number
          quantity: number
          line_total: number
          notes?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          order_id?: string
          product_id?: string | null
          name?: string
          unit_price?: number
          quantity?: number
          line_total?: number
          notes?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          }
        ]
      }
      device_pairing_codes: {
        Row: {
          id: string
          pairing_code: string
          business_id: string
          branch_id: string
          created_by: string | null
          status: string
          created_at: string
          expires_at: string
          used_at: string | null
        }
        Insert: {
          id?: string
          pairing_code: string
          business_id: string
          branch_id: string
          created_by?: string | null
          status?: string
          created_at?: string
          expires_at: string
          used_at?: string | null
        }
        Update: {
          id?: string
          pairing_code?: string
          business_id?: string
          branch_id?: string
          created_by?: string | null
          status?: string
          created_at?: string
          expires_at?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_pairing_codes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_pairing_codes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "device_pairing_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          }
        ]
      }
      audit_logs: {
        Row: {
          id: string
          event_id: string
          business_id: string
          branch_id: string | null
          device_id: string | null
          actor_id: string | null
          entity_id: string | null
          event_type: string
          details: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          event_id: string
          business_id: string
          branch_id?: string | null
          device_id?: string | null
          actor_id?: string | null
          entity_id?: string | null
          event_type: string
          details?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          event_id?: string
          business_id?: string
          branch_id?: string | null
          device_id?: string | null
          actor_id?: string | null
          entity_id?: string | null
          event_type?: string
          details?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_business_with_owner_and_branch: {
        Args: {
          business_name: string
          branch_name: string
          branch_location?: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
