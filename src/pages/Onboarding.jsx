import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Onboarding.module.css';

export default function Onboarding() {
    const navigate = useNavigate();
    const [currentSlide, setCurrentSlide] = useState(0);

    const [touchStart, setTouchStart] = useState(null);
    const [touchEnd, setTouchEnd] = useState(null);
    const minSwipeDistance = 50;

    const slides = [
        {
            icon: "sports_football",
            title: "Welcome to Huddle",
            desc: "The ultimate command center for your fantasy football empire. Sync your leagues, track historical records, and manage your dynasty."
        },
        {
            icon: "psychology",
            title: "Advanced Scouting",
            desc: "Stop guessing. Utilize our dedicated Trade Graders, Draft Pipelines, and Start/Sit Analytics to secure your championship."
        },
        {
            icon: "workspace_premium",
            title: "Try Huddle Pro Free",
            desc: "Start your 7-day free trial to unlock unlimited league connections, and full access to advanced scouting tools."
        }
    ];

    const onTouchStart = (e) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientX);
    };

    const onTouchMove = (e) => {
        setTouchEnd(e.targetTouches[0].clientX);
    };

    const onTouchEndHandler = () => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        const isLeftSwipe = distance > minSwipeDistance;
        const isRightSwipe = distance < -minSwipeDistance;

        if (isLeftSwipe && currentSlide < slides.length - 1) {
            setCurrentSlide(prev => prev + 1);
        }
        if (isRightSwipe && currentSlide > 0) {
            setCurrentSlide(prev => prev - 1);
        }
    };

    const finishOnboarding = () => {
        localStorage.setItem('hasSeenOnboarding', 'true');
        navigate('/login');
    };

    return (
        <div 
            className={styles.container}
            onTouchStart={onTouchStart} 
            onTouchMove={onTouchMove} 
            onTouchEnd={onTouchEndHandler}
        >
            <div className={styles.slideContainer}>
                <i className="material-icons" style={{ fontSize: '80px', color: '#eebf1c', marginBottom: '20px' }}>
                    {slides[currentSlide].icon}
                </i>
                <h1 className={styles.title}>{slides[currentSlide].title}</h1>
                <p className={styles.desc}>{slides[currentSlide].desc}</p>
            </div>

            <div className={styles.controls}>
                <div className={styles.dots}>
                    {slides.map((_, idx) => (
                        <div key={idx} className={`${styles.dot} ${idx === currentSlide ? styles.activeDot : ''}`} />
                    ))}
                </div>

                {currentSlide === slides.length - 1 ? (
                    <button className={styles.actionBtn} onClick={finishOnboarding}>Get Started</button>
                ) : (
                    <button className={styles.actionBtnSecondary} onClick={() => setCurrentSlide(prev => prev + 1)}>Next</button>
                )}
            </div>
        </div>
    );
}