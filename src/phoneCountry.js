// Selector de prefijo telefónico por país con banderas y buscador.
export const COUNTRIES = [
  { code: 'ES', flag: '🇪🇸', name: 'España', dial: '+34' },
  { code: 'AD', flag: '🇦🇩', name: 'Andorra', dial: '+376' },
  { code: 'AE', flag: '🇦🇪', name: 'Emiratos Árabes', dial: '+971' },
  { code: 'AF', flag: '🇦🇫', name: 'Afganistán', dial: '+93' },
  { code: 'AG', flag: '🇦🇬', name: 'Antigua y Barbuda', dial: '+1268' },
  { code: 'AL', flag: '🇦🇱', name: 'Albania', dial: '+355' },
  { code: 'AM', flag: '🇦🇲', name: 'Armenia', dial: '+374' },
  { code: 'AO', flag: '🇦🇴', name: 'Angola', dial: '+244' },
  { code: 'AR', flag: '🇦🇷', name: 'Argentina', dial: '+54' },
  { code: 'AT', flag: '🇦🇹', name: 'Austria', dial: '+43' },
  { code: 'AU', flag: '🇦🇺', name: 'Australia', dial: '+61' },
  { code: 'AZ', flag: '🇦🇿', name: 'Azerbaiyán', dial: '+994' },
  { code: 'BA', flag: '🇧🇦', name: 'Bosnia y Herzegovina', dial: '+387' },
  { code: 'BB', flag: '🇧🇧', name: 'Barbados', dial: '+1246' },
  { code: 'BD', flag: '🇧🇩', name: 'Bangladesh', dial: '+880' },
  { code: 'BE', flag: '🇧🇪', name: 'Bélgica', dial: '+32' },
  { code: 'BF', flag: '🇧🇫', name: 'Burkina Faso', dial: '+226' },
  { code: 'BG', flag: '🇧🇬', name: 'Bulgaria', dial: '+359' },
  { code: 'BH', flag: '🇧🇭', name: 'Baréin', dial: '+973' },
  { code: 'BI', flag: '🇧🇮', name: 'Burundi', dial: '+257' },
  { code: 'BJ', flag: '🇧🇯', name: 'Benín', dial: '+229' },
  { code: 'BN', flag: '🇧🇳', name: 'Brunéi', dial: '+673' },
  { code: 'BO', flag: '🇧🇴', name: 'Bolivia', dial: '+591' },
  { code: 'BR', flag: '🇧🇷', name: 'Brasil', dial: '+55' },
  { code: 'BS', flag: '🇧🇸', name: 'Bahamas', dial: '+1242' },
  { code: 'BT', flag: '🇧🇹', name: 'Bután', dial: '+975' },
  { code: 'BW', flag: '🇧🇼', name: 'Botsuana', dial: '+267' },
  { code: 'BY', flag: '🇧🇾', name: 'Bielorrusia', dial: '+375' },
  { code: 'BZ', flag: '🇧🇿', name: 'Belice', dial: '+501' },
  { code: 'CA', flag: '🇨🇦', name: 'Canadá', dial: '+1' },
  { code: 'CD', flag: '🇨🇩', name: 'Congo (RD)', dial: '+243' },
  { code: 'CF', flag: '🇨🇫', name: 'Rep. Centroafricana', dial: '+236' },
  { code: 'CG', flag: '🇨🇬', name: 'Congo', dial: '+242' },
  { code: 'CH', flag: '🇨🇭', name: 'Suiza', dial: '+41' },
  { code: 'CI', flag: '🇨🇮', name: 'Costa de Marfil', dial: '+225' },
  { code: 'CL', flag: '🇨🇱', name: 'Chile', dial: '+56' },
  { code: 'CM', flag: '🇨🇲', name: 'Camerún', dial: '+237' },
  { code: 'CN', flag: '🇨🇳', name: 'China', dial: '+86' },
  { code: 'CO', flag: '🇨🇴', name: 'Colombia', dial: '+57' },
  { code: 'CR', flag: '🇨🇷', name: 'Costa Rica', dial: '+506' },
  { code: 'CU', flag: '🇨🇺', name: 'Cuba', dial: '+53' },
  { code: 'CV', flag: '🇨🇻', name: 'Cabo Verde', dial: '+238' },
  { code: 'CY', flag: '🇨🇾', name: 'Chipre', dial: '+357' },
  { code: 'CZ', flag: '🇨🇿', name: 'República Checa', dial: '+420' },
  { code: 'DE', flag: '🇩🇪', name: 'Alemania', dial: '+49' },
  { code: 'DJ', flag: '🇩🇯', name: 'Yibuti', dial: '+253' },
  { code: 'DK', flag: '🇩🇰', name: 'Dinamarca', dial: '+45' },
  { code: 'DM', flag: '🇩🇲', name: 'Dominica', dial: '+1767' },
  { code: 'DO', flag: '🇩🇴', name: 'Rep. Dominicana', dial: '+1809' },
  { code: 'DZ', flag: '🇩🇿', name: 'Argelia', dial: '+213' },
  { code: 'EC', flag: '🇪🇨', name: 'Ecuador', dial: '+593' },
  { code: 'EE', flag: '🇪🇪', name: 'Estonia', dial: '+372' },
  { code: 'EG', flag: '🇪🇬', name: 'Egipto', dial: '+20' },
  { code: 'ER', flag: '🇪🇷', name: 'Eritrea', dial: '+291' },
  { code: 'ET', flag: '🇪🇹', name: 'Etiopía', dial: '+251' },
  { code: 'FI', flag: '🇫🇮', name: 'Finlandia', dial: '+358' },
  { code: 'FJ', flag: '🇫🇯', name: 'Fiyi', dial: '+679' },
  { code: 'FR', flag: '🇫🇷', name: 'Francia', dial: '+33' },
  { code: 'GA', flag: '🇬🇦', name: 'Gabón', dial: '+241' },
  { code: 'GB', flag: '🇬🇧', name: 'Reino Unido', dial: '+44' },
  { code: 'GD', flag: '🇬🇩', name: 'Granada', dial: '+1473' },
  { code: 'GE', flag: '🇬🇪', name: 'Georgia', dial: '+995' },
  { code: 'GH', flag: '🇬🇭', name: 'Ghana', dial: '+233' },
  { code: 'GM', flag: '🇬🇲', name: 'Gambia', dial: '+220' },
  { code: 'GN', flag: '🇬🇳', name: 'Guinea', dial: '+224' },
  { code: 'GQ', flag: '🇬🇶', name: 'Guinea Ecuatorial', dial: '+240' },
  { code: 'GR', flag: '🇬🇷', name: 'Grecia', dial: '+30' },
  { code: 'GT', flag: '🇬🇹', name: 'Guatemala', dial: '+502' },
  { code: 'GW', flag: '🇬🇼', name: 'Guinea-Bisáu', dial: '+245' },
  { code: 'GY', flag: '🇬🇾', name: 'Guyana', dial: '+592' },
  { code: 'HN', flag: '🇭🇳', name: 'Honduras', dial: '+504' },
  { code: 'HR', flag: '🇭🇷', name: 'Croacia', dial: '+385' },
  { code: 'HT', flag: '🇭🇹', name: 'Haití', dial: '+509' },
  { code: 'HU', flag: '🇭🇺', name: 'Hungría', dial: '+36' },
  { code: 'ID', flag: '🇮🇩', name: 'Indonesia', dial: '+62' },
  { code: 'IE', flag: '🇮🇪', name: 'Irlanda', dial: '+353' },
  { code: 'IL', flag: '🇮🇱', name: 'Israel', dial: '+972' },
  { code: 'IN', flag: '🇮🇳', name: 'India', dial: '+91' },
  { code: 'IQ', flag: '🇮🇶', name: 'Irak', dial: '+964' },
  { code: 'IR', flag: '🇮🇷', name: 'Irán', dial: '+98' },
  { code: 'IS', flag: '🇮🇸', name: 'Islandia', dial: '+354' },
  { code: 'IT', flag: '🇮🇹', name: 'Italia', dial: '+39' },
  { code: 'JM', flag: '🇯🇲', name: 'Jamaica', dial: '+1876' },
  { code: 'JO', flag: '🇯🇴', name: 'Jordania', dial: '+962' },
  { code: 'JP', flag: '🇯🇵', name: 'Japón', dial: '+81' },
  { code: 'KE', flag: '🇰🇪', name: 'Kenia', dial: '+254' },
  { code: 'KG', flag: '🇰🇬', name: 'Kirguistán', dial: '+996' },
  { code: 'KH', flag: '🇰🇭', name: 'Camboya', dial: '+855' },
  { code: 'KI', flag: '🇰🇮', name: 'Kiribati', dial: '+686' },
  { code: 'KM', flag: '🇰🇲', name: 'Comoras', dial: '+269' },
  { code: 'KN', flag: '🇰🇳', name: 'San Cristóbal y Nieves', dial: '+1869' },
  { code: 'KP', flag: '🇰🇵', name: 'Corea del Norte', dial: '+850' },
  { code: 'KR', flag: '🇰🇷', name: 'Corea del Sur', dial: '+82' },
  { code: 'KW', flag: '🇰🇼', name: 'Kuwait', dial: '+965' },
  { code: 'KZ', flag: '🇰🇿', name: 'Kazajistán', dial: '+7' },
  { code: 'LA', flag: '🇱🇦', name: 'Laos', dial: '+856' },
  { code: 'LB', flag: '🇱🇧', name: 'Líbano', dial: '+961' },
  { code: 'LC', flag: '🇱🇨', name: 'Santa Lucía', dial: '+1758' },
  { code: 'LI', flag: '🇱🇮', name: 'Liechtenstein', dial: '+423' },
  { code: 'LK', flag: '🇱🇰', name: 'Sri Lanka', dial: '+94' },
  { code: 'LR', flag: '🇱🇷', name: 'Liberia', dial: '+231' },
  { code: 'LS', flag: '🇱🇸', name: 'Lesoto', dial: '+266' },
  { code: 'LT', flag: '🇱🇹', name: 'Lituania', dial: '+370' },
  { code: 'LU', flag: '🇱🇺', name: 'Luxemburgo', dial: '+352' },
  { code: 'LV', flag: '🇱🇻', name: 'Letonia', dial: '+371' },
  { code: 'LY', flag: '🇱🇾', name: 'Libia', dial: '+218' },
  { code: 'MA', flag: '🇲🇦', name: 'Marruecos', dial: '+212' },
  { code: 'MC', flag: '🇲🇨', name: 'Mónaco', dial: '+377' },
  { code: 'MD', flag: '🇲🇩', name: 'Moldavia', dial: '+373' },
  { code: 'ME', flag: '🇲🇪', name: 'Montenegro', dial: '+382' },
  { code: 'MG', flag: '🇲🇬', name: 'Madagascar', dial: '+261' },
  { code: 'MH', flag: '🇲🇭', name: 'Islas Marshall', dial: '+692' },
  { code: 'MK', flag: '🇲🇰', name: 'Macedonia del Norte', dial: '+389' },
  { code: 'ML', flag: '🇲🇱', name: 'Malí', dial: '+223' },
  { code: 'MM', flag: '🇲🇲', name: 'Myanmar', dial: '+95' },
  { code: 'MN', flag: '🇲🇳', name: 'Mongolia', dial: '+976' },
  { code: 'MR', flag: '🇲🇷', name: 'Mauritania', dial: '+222' },
  { code: 'MT', flag: '🇲🇹', name: 'Malta', dial: '+356' },
  { code: 'MU', flag: '🇲🇺', name: 'Mauricio', dial: '+230' },
  { code: 'MV', flag: '🇲🇻', name: 'Maldivas', dial: '+960' },
  { code: 'MW', flag: '🇲🇼', name: 'Malaui', dial: '+265' },
  { code: 'MX', flag: '🇲🇽', name: 'México', dial: '+52' },
  { code: 'MY', flag: '🇲🇾', name: 'Malasia', dial: '+60' },
  { code: 'MZ', flag: '🇲🇿', name: 'Mozambique', dial: '+258' },
  { code: 'NA', flag: '🇳🇦', name: 'Namibia', dial: '+264' },
  { code: 'NE', flag: '🇳🇪', name: 'Níger', dial: '+227' },
  { code: 'NG', flag: '🇳🇬', name: 'Nigeria', dial: '+234' },
  { code: 'NI', flag: '🇳🇮', name: 'Nicaragua', dial: '+505' },
  { code: 'NL', flag: '🇳🇱', name: 'Países Bajos', dial: '+31' },
  { code: 'NO', flag: '🇳🇴', name: 'Noruega', dial: '+47' },
  { code: 'NP', flag: '🇳🇵', name: 'Nepal', dial: '+977' },
  { code: 'NR', flag: '🇳🇷', name: 'Nauru', dial: '+674' },
  { code: 'NZ', flag: '🇳🇿', name: 'Nueva Zelanda', dial: '+64' },
  { code: 'OM', flag: '🇴🇲', name: 'Omán', dial: '+968' },
  { code: 'PA', flag: '🇵🇦', name: 'Panamá', dial: '+507' },
  { code: 'PE', flag: '🇵🇪', name: 'Perú', dial: '+51' },
  { code: 'PG', flag: '🇵🇬', name: 'Papúa Nueva Guinea', dial: '+675' },
  { code: 'PH', flag: '🇵🇭', name: 'Filipinas', dial: '+63' },
  { code: 'PK', flag: '🇵🇰', name: 'Pakistán', dial: '+92' },
  { code: 'PL', flag: '🇵🇱', name: 'Polonia', dial: '+48' },
  { code: 'PT', flag: '🇵🇹', name: 'Portugal', dial: '+351' },
  { code: 'PW', flag: '🇵🇼', name: 'Palaos', dial: '+680' },
  { code: 'PY', flag: '🇵🇾', name: 'Paraguay', dial: '+595' },
  { code: 'QA', flag: '🇶🇦', name: 'Catar', dial: '+974' },
  { code: 'RO', flag: '🇷🇴', name: 'Rumanía', dial: '+40' },
  { code: 'RS', flag: '🇷🇸', name: 'Serbia', dial: '+381' },
  { code: 'RU', flag: '🇷🇺', name: 'Rusia', dial: '+7' },
  { code: 'RW', flag: '🇷🇼', name: 'Ruanda', dial: '+250' },
  { code: 'SA', flag: '🇸🇦', name: 'Arabia Saudí', dial: '+966' },
  { code: 'SB', flag: '🇸🇧', name: 'Islas Salomón', dial: '+677' },
  { code: 'SC', flag: '🇸🇨', name: 'Seychelles', dial: '+248' },
  { code: 'SD', flag: '🇸🇩', name: 'Sudán', dial: '+249' },
  { code: 'SE', flag: '🇸🇪', name: 'Suecia', dial: '+46' },
  { code: 'SG', flag: '🇸🇬', name: 'Singapur', dial: '+65' },
  { code: 'SI', flag: '🇸🇮', name: 'Eslovenia', dial: '+386' },
  { code: 'SK', flag: '🇸🇰', name: 'Eslovaquia', dial: '+421' },
  { code: 'SL', flag: '🇸🇱', name: 'Sierra Leona', dial: '+232' },
  { code: 'SM', flag: '🇸🇲', name: 'San Marino', dial: '+378' },
  { code: 'SN', flag: '🇸🇳', name: 'Senegal', dial: '+221' },
  { code: 'SO', flag: '🇸🇴', name: 'Somalia', dial: '+252' },
  { code: 'SR', flag: '🇸🇷', name: 'Surinam', dial: '+597' },
  { code: 'SS', flag: '🇸🇸', name: 'Sudán del Sur', dial: '+211' },
  { code: 'ST', flag: '🇸🇹', name: 'Santo Tomé y Príncipe', dial: '+239' },
  { code: 'SV', flag: '🇸🇻', name: 'El Salvador', dial: '+503' },
  { code: 'SY', flag: '🇸🇾', name: 'Siria', dial: '+963' },
  { code: 'SZ', flag: '🇸🇿', name: 'Suazilandia', dial: '+268' },
  { code: 'TD', flag: '🇹🇩', name: 'Chad', dial: '+235' },
  { code: 'TG', flag: '🇹🇬', name: 'Togo', dial: '+228' },
  { code: 'TH', flag: '🇹🇭', name: 'Tailandia', dial: '+66' },
  { code: 'TJ', flag: '🇹🇯', name: 'Tayikistán', dial: '+992' },
  { code: 'TL', flag: '🇹🇱', name: 'Timor Oriental', dial: '+670' },
  { code: 'TM', flag: '🇹🇲', name: 'Turkmenistán', dial: '+993' },
  { code: 'TN', flag: '🇹🇳', name: 'Túnez', dial: '+216' },
  { code: 'TO', flag: '🇹🇴', name: 'Tonga', dial: '+676' },
  { code: 'TR', flag: '🇹🇷', name: 'Turquía', dial: '+90' },
  { code: 'TT', flag: '🇹🇹', name: 'Trinidad y Tobago', dial: '+1868' },
  { code: 'TV', flag: '🇹🇻', name: 'Tuvalu', dial: '+688' },
  { code: 'TZ', flag: '🇹🇿', name: 'Tanzania', dial: '+255' },
  { code: 'UA', flag: '🇺🇦', name: 'Ucrania', dial: '+380' },
  { code: 'UG', flag: '🇺🇬', name: 'Uganda', dial: '+256' },
  { code: 'US', flag: '🇺🇸', name: 'Estados Unidos', dial: '+1' },
  { code: 'UY', flag: '🇺🇾', name: 'Uruguay', dial: '+598' },
  { code: 'UZ', flag: '🇺🇿', name: 'Uzbekistán', dial: '+998' },
  { code: 'VA', flag: '🇻🇦', name: 'Vaticano', dial: '+39' },
  { code: 'VC', flag: '🇻🇨', name: 'San Vicente y las Granadinas', dial: '+1784' },
  { code: 'VE', flag: '🇻🇪', name: 'Venezuela', dial: '+58' },
  { code: 'VN', flag: '🇻🇳', name: 'Vietnam', dial: '+84' },
  { code: 'VU', flag: '🇻🇺', name: 'Vanuatu', dial: '+678' },
  { code: 'WS', flag: '🇼🇸', name: 'Samoa', dial: '+685' },
  { code: 'YE', flag: '🇾🇪', name: 'Yemen', dial: '+967' },
  { code: 'ZA', flag: '🇿🇦', name: 'Sudáfrica', dial: '+27' },
  { code: 'ZM', flag: '🇿🇲', name: 'Zambia', dial: '+260' },
  { code: 'ZW', flag: '🇿🇼', name: 'Zimbabue', dial: '+263' },
];

let selectedCountry = COUNTRIES.find((c) => c.code === 'ES');

const btn = document.getElementById('phone-country-btn');
const flagEl = document.getElementById('phone-country-flag');
const codeEl = document.getElementById('phone-country-code');
const dropdown = document.getElementById('phone-country-dropdown');
const searchInput = document.getElementById('phone-country-search');
const list = document.getElementById('phone-country-list');

function renderList(filter = '') {
  const q = filter.toLowerCase();
  const filtered = q
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.dial.includes(q))
    : COUNTRIES;
  list.innerHTML = '';
  filtered.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'phone-country-option' + (c.code === selectedCountry.code ? ' selected' : '');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', c.code === selectedCountry.code ? 'true' : 'false');
    li.innerHTML = `<span class="pco-flag">${c.flag}</span><span class="pco-name">${c.name}</span><span class="pco-dial">${c.dial}</span>`;
    li.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectCountry(c);
    });
    list.appendChild(li);
  });
}

function selectCountry(c) {
  selectedCountry = c;
  flagEl.textContent = c.flag;
  codeEl.textContent = c.dial;
  closeDropdown();
}

function openDropdown() {
  dropdown.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  searchInput.value = '';
  renderList();
  // Scroll al seleccionado
  const sel = list.querySelector('.selected');
  if (sel) setTimeout(() => sel.scrollIntoView({ block: 'nearest' }), 0);
  searchInput.focus();
}

function closeDropdown() {
  dropdown.hidden = true;
  btn.setAttribute('aria-expanded', 'false');
}

btn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (dropdown.hidden) openDropdown();
  else closeDropdown();
});

searchInput.addEventListener('input', () => renderList(searchInput.value));

document.addEventListener('click', (e) => {
  if (!dropdown.hidden && !dropdown.closest('.phone-input-wrap').contains(e.target)) closeDropdown();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dropdown.hidden) closeDropdown();
});

/** Devuelve el número completo con prefijo (p. ej. "+34600000000"). */
export function getFullPhone(localNumber) {
  const n = localNumber.replace(/\s/g, '');
  if (!n) return '';
  return `${selectedCountry.dial}${n}`;
}

/** Restablece el selector al país por defecto (España) y vacía el input. */
export function resetPhoneCountry() {
  selectedCountry = COUNTRIES.find((c) => c.code === 'ES');
  flagEl.textContent = selectedCountry.flag;
  codeEl.textContent = selectedCountry.dial;
}

/** Precarga el selector con un número ya guardado (p. ej. al reabrir el modal). */
export function setPhoneValue(fullPhone) {
  if (!fullPhone) return;
  const match = COUNTRIES.slice().sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => fullPhone.startsWith(c.dial));
  if (match) selectCountry(match);
}
