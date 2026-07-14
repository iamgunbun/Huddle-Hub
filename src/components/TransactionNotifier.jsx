import React, { useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useLeague } from '../context/LeagueContext';

export default function TransactionNotifier() {
    const { activeLeague } = useLeague();

    useEffect(() => {
        if (!activeLeague?.id) return;

        // Listen for inserts on the transactions table
        const channel = supabase
            .channel('db-changes')
            .on('postgres_changes', { 
                event: 'INSERT', 
                schema: 'public', 
                table: 'transactions',
                filter: `league_id=eq.${activeLeague.id}` 
            }, (payload) => {
                alert(`New Transaction: ${payload.new.type}`); // Simplified notification; replace with a Toast library
            })
            .subscribe();

        return () => { supabase.removeChannel(channel); };
    }, [activeLeague]);

    return null; // Invisible component
}