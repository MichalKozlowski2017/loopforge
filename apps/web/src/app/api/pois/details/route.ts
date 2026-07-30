import { NextResponse } from "next/server";
import { googleMapsSearchUri, type PoiDetails } from "@/lib/pois";

const USER_AGENT = "Loopforge/1.0 (https://loopforge.pl; contact@loopforge.pl)";

function mapsApiKey(): string | null {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    null
  );
}

type GooglePlace = {
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  formattedAddress?: string;
  displayName?: { text?: string };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get("name")?.trim() ?? "";
  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Brak parametrów" }, { status: 400 });
  }

  const fallback: PoiDetails = {
    googleMapsUri: googleMapsSearchUri(name, lat, lng),
    source: "maps-link",
  };

  const apiKey = mapsApiKey();
  if (!apiKey) {
    return NextResponse.json(fallback);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.displayName,places.rating,places.userRatingCount,places.googleMapsUri,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.regularOpeningHours",
        },
        body: JSON.stringify({
          textQuery: name,
          languageCode: "pl",
          maxResultCount: 3,
          locationBias: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: 250,
            },
          },
        }),
        signal: controller.signal,
        next: { revalidate: 86_400 },
      },
    );

    if (!response.ok) {
      console.warn("[loopforge] Places searchText HTTP", response.status);
      return NextResponse.json(fallback);
    }

    const data = (await response.json()) as { places?: GooglePlace[] };
    const place = data.places?.[0];
    if (!place) return NextResponse.json(fallback);

    const hours = place.regularOpeningHours?.weekdayDescriptions?.join("; ");

    const details: PoiDetails = {
      rating: typeof place.rating === "number" ? place.rating : undefined,
      userRatingCount:
        typeof place.userRatingCount === "number"
          ? place.userRatingCount
          : undefined,
      address: place.formattedAddress,
      phone: place.nationalPhoneNumber,
      website: place.websiteUri,
      openingHours: hours,
      googleMapsUri: place.googleMapsUri ?? fallback.googleMapsUri,
      source: "google",
    };

    return NextResponse.json(details);
  } catch (error) {
    console.warn("[loopforge] Places enrich failed:", error);
    return NextResponse.json(fallback);
  } finally {
    clearTimeout(timer);
  }
}
