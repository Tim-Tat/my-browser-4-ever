import logo from '../../../../assets/logo/mark-gradient.svg';

// Statische Sidebar, noch ohne Funktion
export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Seitenleiste">
      <header className="brand">
        <img src={logo} alt="" width={28} height={28} />
        <span>Aven</span>
        <small>0.0.1-alpha</small>
      </header>

      <div className="address" aria-hidden="true">www.wikipedia.org</div>

      <section>
        <h2>Angeheftet</h2>
        <ul>
          <li className="tab pinned">Beispiel-Pin</li>
          <li className="tab pinned">Beispiel-Pin</li>
        </ul>
      </section>

      <section>
        <h2>Space 1</h2>
        <ul>
          <li className="tab active">Wikipedia</li>
          <li className="tab">Beispiel-Tab</li>
        </ul>
      </section>

      <footer>Nur Umriss – noch ohne Funktion</footer>
    </aside>
  );
}
