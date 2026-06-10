'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { MapPin, Phone, ArrowRight, Truck, Clock, Award } from 'lucide-react';
import ConcreteOrderPage from '../ConcreteOrderPageContent';

export default function TradeComLanding() {
  const [showOrderForm, setShowOrderForm] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.15 });

    document.querySelectorAll('.section').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#05070f',
      color: '#ffffff',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflowX: 'hidden'
    }}>

      {/* HERO */}
      <header style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0a0f1c 0%, #02040a 100%)',
        overflow: 'hidden'
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 30%, rgba(59, 130, 246, 0.22) 0%, transparent 70%)' }} />

        <div style={{ position: 'relative', zIndex: 10, textAlign: 'center', padding: '0 24px', maxWidth: '1200px' }}>
          <Image src="/logo.jpg" alt="ТрейдКом" width={380} height={130} style={{ margin: '0 auto 40px' }} />
          
          <h1 style={{
            fontSize: 'clamp(56px, 9vw, 120px)',
            fontWeight: 800,
            letterSpacing: '-4px',
            lineHeight: 1,
            marginBottom: '20px',
            background: 'linear-gradient(90deg, #e0f2fe, #93c5fd, #60a5fa)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>
            ТРЕЙДКОМ
          </h1>

          <p style={{ fontSize: 'clamp(28px, 5.5vw, 48px)', color: '#60a5fa', marginBottom: '32px' }}>
            Мостовой бетон в Брянске
          </p>
          <p style={{ fontSize: '23px', maxWidth: '720px', margin: '0 auto 60px', color: '#cbd5e1', lineHeight: 1.5 }}>
            Производство • Доставка • Высокое качество
          </p>

          <button 
            onClick={() => setShowOrderForm(true)}
            style={{
              background: 'linear-gradient(90deg, #1e40af, #3b82f6)',
              color: 'white',
              padding: '28px 80px',
              fontSize: '27px',
              fontWeight: 700,
              borderRadius: '20px',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 25px 50px -12px rgb(37 99 235)'
            }}
          >
            Заказать бетон сейчас <ArrowRight style={{ marginLeft: '15px' }} />
          </button>
        </div>
      </header>

      {/* СТАТИСТИКА */}
      <section className="section" style={{ padding: '80px 24px', backgroundColor: '#0a0f1c' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '40px', textAlign: 'center' }}>
          {[
            { number: '5000+', label: 'м³ бетона в месяц' },
            { number: '120+', label: 'Постоянных клиентов' },
            { number: '8', label: 'Автобетоносмесителей' },
            { number: '15', label: 'Лет опыта' },
          ].map((stat, i) => (
            <div key={i}>
              <div style={{ fontSize: '56px', fontWeight: 800, color: '#60a5fa' }}>{stat.number}</div>
              <div style={{ fontSize: '20px', color: '#94a3b8' }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* АССОРТИМЕНТ — из mostbeton.ru */}
      <section id="prices" className="section" style={{ padding: '120px 24px', backgroundColor: '#05070f' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '52px', marginBottom: '30px' }}>Ассортимент продукции</h2>
          <p style={{ color: '#64748b', fontSize: '22px', marginBottom: '70px' }}>Цены с НДС • Июнь 2026</p>

          <div style={{ background: 'rgba(15, 23, 42, 0.95)', borderRadius: '28px', overflow: 'hidden', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#0f172a' }}>
                  <th style={{ padding: '25px', textAlign: 'left' }}>Наименование</th>
                  <th style={{ padding: '25px', textAlign: 'left' }}>Марка</th>
                  <th style={{ padding: '25px', textAlign: 'right' }}>Цена за м³</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderTop: '1px solid #1e2937' }}><td colSpan={3} style={{ padding: '20px 25px', fontWeight: 700, color: '#60a5fa' }}>БЕТОН</td></tr>
                {[
                  ['М100', '6380 ₽ (гранит)'],
                  ['М150', '6500 ₽'],
                  ['М200', '6600 ₽'],
                  ['М250', '6950 ₽'],
                  ['М300', '7230 ₽'],
                  ['М350', '7400 ₽'],
                  ['М400', '8050 ₽'],
                  ['М450', '8350 ₽'],
                  ['М500', '8700 ₽'],
                ].map(([mark, price]) => (
                  <tr key={mark} style={{ borderTop: '1px solid #1e2937' }}>
                    <td style={{ padding: '25px', fontSize: '22px' }}>Бетон</td>
                    <td style={{ padding: '25px', fontSize: '22px', fontWeight: 700 }}>{mark}</td>
                    <td style={{ padding: '25px', textAlign: 'right', fontSize: '24px', color: '#60a5fa' }}>{price}</td>
                  </tr>
                ))}

                <tr style={{ borderTop: '1px solid #1e2937' }}><td colSpan={3} style={{ padding: '20px 25px', fontWeight: 700, color: '#60a5fa' }}>РАСТВОР</td></tr>
                {[
                  ['М100', '4100 ₽'],
                  ['М150', '4400 ₽'],
                  ['М200', '5100 ₽'],
                  ['М250', '5500 ₽'],
                  ['М300', '5900 ₽'],
                ].map(([mark, price]) => (
                  <tr key={mark} style={{ borderTop: '1px solid #1e2937' }}>
                    <td style={{ padding: '25px', fontSize: '22px' }}>Раствор</td>
                    <td style={{ padding: '25px', fontSize: '22px', fontWeight: 700 }}>{mark}</td>
                    <td style={{ padding: '25px', textAlign: 'right', fontSize: '24px', color: '#60a5fa' }}>{price}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ДОСТАВКА — из mostbeton.ru */}
      <section className="section" style={{ padding: '120px 24px', backgroundColor: '#0a0f1c' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '48px', textAlign: 'center', marginBottom: '60px' }}>Стоимость доставки</h2>
          
          <div style={{ background: 'rgba(15, 23, 42, 0.95)', borderRadius: '24px', padding: '50px', border: '1px solid #1e40af' }}>
            <h3 style={{ fontSize: '28px', marginBottom: '30px', color: '#93c5fd' }}>Автобетоносмеситель</h3>
            <p style={{ fontSize: '20px', marginBottom: '30px' }}>
              <strong>По г. Брянск:</strong> 5500 – 9000 ₽<br />
              <strong>По области:</strong> 230 – 350 ₽ / км
            </p>

            <h3 style={{ fontSize: '26px', margin: '40px 0 20px', color: '#93c5fd' }}>Дополнительные услуги</h3>
            <ul style={{ fontSize: '19px', lineHeight: 1.7, color: '#cbd5e1' }}>
              <li>Выгрузка миксера (до 50 мин) — включена</li>
              <li>Сверхнормативный простой — 25 ₽ / минута</li>
              <li>Выгрузка через трубу — 1500 ₽</li>
              <li>Автобетононасос — 6700 ₽ / час (мин. 5 часов)</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ФОРМА ЗАКАЗА */}
      <section id="order" className="section" style={{ padding: '100px 24px', backgroundColor: '#05070f' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: '48px', marginBottom: '30px' }}>Оформить заявку</h2>
          <p style={{ fontSize: '23px', color: '#93c5fd', marginBottom: '60px' }}>Заполните форму ниже — менеджер свяжется с вами</p>

          {showOrderForm ? (
            <div style={{ background: '#0f172a', borderRadius: '28px', padding: '40px 30px', border: '1px solid #1e40af' }}>
              <ConcreteOrderPage />
            </div>
          ) : (
            <button 
              onClick={() => setShowOrderForm(true)}
              style={{
                background: 'linear-gradient(90deg, #1e40af, #3b82f6)',
                color: 'white',
                padding: '32px 90px',
                fontSize: '28px',
                fontWeight: 700,
                borderRadius: '20px',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Открыть форму заказа
            </button>
          )}
        </div>
      </section>

      {/* ФУТЕР */}
      <footer style={{ background: '#020407', padding: '100px 24px 60px', borderTop: '1px solid #1e2937' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '60px', textAlign: 'center' }}>
          <div>
            <Image src="/logo.jpg" alt="ТрейдКом" width={240} height={80} />
            <p style={{ marginTop: '30px', color: '#64748b' }}>© 2026 ТрейдКом</p>
          </div>
          <div style={{ fontSize: '22px' }}>
            <a href="tel:+79621382223" style={{ color: '#e2e8f0' }}>+7 (962) 138-22-23</a>
            <br /><br />
            <a href="mailto:sheben32@yandex.ru" style={{ color: '#60a5fa' }}>sheben32@yandex.ru</a>
          </div>
          <div style={{ color: '#64748b' }}>
            г. Брянск, Орловский тупик, стр.6
          </div>
        </div>
      </footer>

      <style jsx global>{`
        .section {
          opacity: 0;
          transform: translateY(80px);
          transition: all 1s cubic-bezier(0.25, 0.1, 0.25, 1);
        }
        .section.visible {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>
    </div>
  );
}