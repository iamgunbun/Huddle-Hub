import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Capacitor } from '@capacitor/core';
import { Purchases } from '@revenuecat/purchases-capacitor';
import styles from './PremiumModal.module.css';

export default function PremiumModal({ onClose }) {
    const [processing, setProcessing] = useState(false);

    const handleUpgrade = async () => {
        setProcessing(true);
        
        // 1. Fetch the user directly at the exact moment of the click
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error || !user) {
            alert("Please log in to upgrade your account.");
            setProcessing(false);
            return;
        }

        // NATIVE CHECKOUT FLOW (Google Play / App Store via RevenueCat)
        if (Capacitor.isNativePlatform()) {
            try {
                await Purchases.logIn({ appUserID: user.id });
                
                const offerings = await Purchases.getOfferings();
                if (offerings.current !== null && offerings.current.availablePackages.length !== 0) {
                    
                    const { customerInfo } = await Purchases.purchasePackage({ 
                        package: offerings.current.availablePackages[0] 
                    });
                    
                    if (typeof customerInfo.entitlements.active['premium'] !== "undefined") {
                        await supabase.from('profiles').update({ is_premium: true }).eq('id', user.id);
                        alert("Welcome to Huddle Premium!");
                        window.location.reload(); 
                    }
                } else {
                    alert("No subscriptions available at this time.");
                }
            } catch (e) {
                if (!e.userCancelled) {
                    alert(`Transaction Error: ${e.message}`);
                }
            } finally {
                setProcessing(false);
            }
        } else {
            // WEB CHECKOUT FLOW (Stripe)
            // Using an environment variable so Vercel can automatically swap in your Live link!
            const stripePaymentUrl = `${import.meta.env.VITE_STRIPE_PAYMENT_URL}?client_reference_id=${user.id}`;
            window.location.href = stripePaymentUrl;
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
                <button className={styles.closeBtn} onClick={onClose}>
                    <i className="material-icons">close</i>
                </button>
                
                <div className={styles.header}>
                    <img 
                        src="/pro-banner.png" 
                        alt="Huddle Pro" 
                        style={{ height: '70px', objectFit: 'contain', display: 'block', margin: '0 auto 15px auto' }} 
                    />
                    <p className={styles.subtitle}>Unlock the ultimate dynasty experience.</p>
                </div>

                <ul className={styles.featureList}>
                    <li><i className="material-icons">check_circle</i> <span><strong>Unlimited Leagues:</strong> Connect as many leagues as you want (Free tier is limited to 2).</span></li>
                    <li><i className="material-icons">check_circle</i> <span><strong>Scouting Pipelines:</strong> Full access to the Trade and Draft Graders.</span></li>
                    <li><i className="material-icons">check_circle</i> <span><strong>Start/Sit Verdicts:</strong> Deep-dive tactical verdicts for your toughest lineup decisions.</span></li>
                    <li><i className="material-icons">check_circle</i> <span><strong>Extended Manager Evals:</strong> Up to 5 manual franchise evaluations per manager per season.</span></li>
                </ul>

                <button className={styles.upgradeBtn} onClick={handleUpgrade} disabled={processing}>
                    {processing ? 'Processing...' : 'Upgrade Now - $9.99 / Season'}
                </button>
            </div>
        </div>
    );
}