package dev.agenttrust.core;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

/** Inclusive UTC calendar days, capped at366 days; no schema or write authority. */
record AuditPeriod(LocalDate startDay,LocalDate endDay,UUID actorId,AuditFilters filters) {
 static AuditPeriod parse(String start,String end,String actor,String action,String resource){
  try{
   if(start==null||end==null||!start.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")||!end.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}"))throw new IllegalArgumentException();
   LocalDate a=LocalDate.parse(start),b=LocalDate.parse(end);
   if(!a.toString().equals(start)||!b.toString().equals(end)||a.isBefore(LocalDate.of(1970,1,1))||b.isAfter(LocalDate.of(9999,12,30))||b.isBefore(a)||ChronoUnit.DAYS.between(a,b)>=366)throw new IllegalArgumentException();
   return new AuditPeriod(a,b,"all".equals(actor)?null:AuditActorCursor.actor(actor),AuditFilters.parse(action,resource));
  }catch(RuntimeException invalid){throw new IllegalArgumentException("Invalid audit period");}
 }
 Instant startInclusive(){return startDay.atStartOfDay(ZoneOffset.UTC).toInstant();}
 Instant endExclusive(){return endDay.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();}
 byte[] digest(){try{return MessageDigest.getInstance("SHA-256").digest(("audit-period-start="+startDay+";end="+endDay+";actor="+(actorId==null?"all":actorId)+";action="+(filters.action()==null?"all":filters.action())+";resource="+(filters.resourceId()==null?"all":filters.resourceId())).getBytes(StandardCharsets.US_ASCII));}catch(java.security.NoSuchAlgorithmException unavailable){throw new IllegalStateException(unavailable);}}
}
