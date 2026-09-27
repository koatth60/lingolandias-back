import {
  Controller,
  Get,
  Post,
  Body,
  Delete,
  ForbiddenException,
  HttpStatus,
  HttpCode,
  Patch,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthGuard } from '../auth/guards/auth.guard';
import { Roles, RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
// import { UpdateUserDto } from './dto/update-user.dto';

@UseGuards(AuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // The caller must be the teacher named in the body, or an admin acting on
  // their behalf (the admin panel's teacher-assignment screens). Every real
  // scheduling screen already sends the logged-in teacher's own id here —
  // this only closes the gap where any other logged-in user could send a
  // different teacherId and act as them.
  private async assertActingTeacher(callerId: string, teacherId: string) {
    if (callerId === teacherId) return;
    const role = await this.usersService.getRole(callerId);
    if (role !== 'admin') throw new ForbiddenException('Not this teacher');
  }

  // Admin panel only: lists every account, hashes excluded but every other
  // field (phone, address, email) included.
  @Get()
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  findAll(@Query() query: any) {
    return this.usersService.findAll({
      page: parseInt(query.page) || 1,
      limit: Math.min(parseInt(query.limit) || 200, 200),
    });
  }

  @Get('admin-dashboard')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  adminDashboard() {
    return this.usersService.findAdminDashboard();
  }

  @Get('admin-stats')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  getAdminStats() {
    return this.usersService.getAdminStats();
  }

  @Get('analytics')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  getAnalytics() {
    return this.usersService.getAnalytics();
  }

  // Every teacher's full student list (name, email, phone, address — not
  // just names) with no role check at all. Both screens that call this
  // (admin panel, admin analytics) are admin-only already; the route itself
  // was not.
  @Get('teachers')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  findTeachers() {
    return this.usersService.findTeachers();
  }

  @Get('students/paginated')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  findStudentsPaginated(@Query() query: any) {
    return this.usersService.findStudentsPaginated({
      page: parseInt(query.page) || 1,
      limit: Math.min(parseInt(query.limit) || 20, 100),
      search: query.search || '',
      language: query.language || '',
      unassignedOnly: query.unassignedOnly === 'true',
    });
  }

  // Open to any logged-in user (used to add people to DMs/groups) — already
  // returns a fixed, non-sensitive field list, no password, no phone/address.
  @Get('search')
  @HttpCode(HttpStatus.OK)
  searchUsers(@Query() query: any) {
    return this.usersService.searchUsers({
      query: query.q || '',
      excludeUserId: query.excludeUserId || undefined,
      limit: Math.min(parseInt(query.limit) || 20, 50),
    });
  }

  @Get(':id/public-profile')
  @HttpCode(HttpStatus.OK)
  getPublicProfile(@Param('id') id: string) {
    return this.usersService.getPublicProfile(id);
  }

  // Not called from the frontend today, but reachable by anyone logged in —
  // restricted to the student themself, their assigned teacher, or an admin.
  @Get('student-schedules/:studentId')
  @HttpCode(HttpStatus.OK)
  async getStudentSchedules(
    @Param('studentId') studentId: string,
    @CurrentUser('id') callerId: string,
  ) {
    await this.usersService.assertCanViewStudent(callerId, studentId);
    return this.usersService.getStudentSchedules(studentId);
  }

  // Every real caller passes their own id; restricted to self, the
  // student's assigned teacher, or an admin so a client-supplied id can't
  // pull someone else's teacher assignment and schedules.
  @Get('student-profile/:studentId')
  @HttpCode(HttpStatus.OK)
  async getStudentProfile(
    @Param('studentId') studentId: string,
    @CurrentUser('id') callerId: string,
  ) {
    await this.usersService.assertCanViewStudent(callerId, studentId);
    return this.usersService.getStudentProfile(studentId);
  }

  // Deliberately left open to any logged-in user beyond the teacher
  // themself: the class-booking screens (picking a time with a teacher who
  // isn't the caller's own) need to see that teacher's busy slots. Each
  // slot's studentName/studentId is only meant for the teacher's own view —
  // see UsersService.getTeacherProfile for how it's scoped per caller.
  @Get('teacher-profile/:teacherId')
  @HttpCode(HttpStatus.OK)
  getTeacherProfile(
    @Param('teacherId') teacherId: string,
    @CurrentUser('id') callerId: string,
  ) {
    return this.usersService.getTeacherProfile(teacherId, callerId);
  }

  // Admin panel only (studentAssignment.jsx).
  @Post('assignstudent')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  assignStudent(@Body() body: any) {
    return this.usersService.assignStudent(body);
  }

  @Post('invitados')
  @HttpCode(HttpStatus.CREATED)
  createInvitado(@Req() req: any, @Body() body: any) {
    return this.usersService.createInvitado(req.user.id, body);
  }

  @Get('invitados')
  @HttpCode(HttpStatus.OK)
  listInvitados(@Req() req: any) {
    return this.usersService.listInvitados(req.user.id);
  }

  @Delete('invitados/:id')
  @HttpCode(HttpStatus.OK)
  removeInvitado(@Req() req: any, @Param('id') id: string) {
    return this.usersService.removeInvitado(req.user.id, id);
  }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.usersService.findOne(+id);
  // }

  // Edits the caller's own profile only (see UsersService.update).
  @Post('updateuser')
  @HttpCode(HttpStatus.OK)
  async update(@CurrentUser('id') userId: string, @Body() updateUser: any) {
    const updatedUser = await this.usersService.update(userId, updateUser);
    return updatedUser;
  }

  // Deletes an account and its schedules and boards — admin panel only.
  @Delete()
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  remove(@Body() body: any) {
    const { email } = body;
    return this.usersService.remove(email);
  }

  @Post('add-event')
  @HttpCode(HttpStatus.OK)
  async addEvent(@Body() body: any, @CurrentUser('id') callerId: string) {
    await this.assertActingTeacher(callerId, body?.teacherId);
    return this.usersService.addEvent(body);
  }

  @Post('removeStudentsFromTeacher')
  @HttpCode(HttpStatus.OK)
  async removeStudentsFromTeacher(@Body() body: any, @CurrentUser('id') callerId: string) {
    await this.assertActingTeacher(callerId, body?.teacherId);
    return this.usersService.removeStudentsFromTeacher(body);
  }

  // The body has no teacherId (only the event's own id) — ownership is
  // checked against the Schedule row itself. See UsersService.modifySchedule.
  @Patch('modify-schedule')
  @HttpCode(HttpStatus.OK)
  async modifySchedule(@Body() body: any, @CurrentUser('id') callerId: string) {
    return this.usersService.modifySchedule(body, callerId);
  }

  @Post('removeEvents')
  @HttpCode(HttpStatus.OK)
  async removeEvents(
    @Body() body: { eventIds: string[]; teacherId: string; studentId: string },
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertActingTeacher(callerId, body?.teacherId);
    return this.usersService.removeEvents(body);
  }

  @Post('schedule-group')
  @HttpCode(HttpStatus.OK)
  async scheduleGroup(@Body() body: any, @CurrentUser('id') callerId: string) {
    await this.assertActingTeacher(callerId, body?.teacherId);
    return this.usersService.scheduleGroup(body);
  }

  @Get('schedule-link')
  @HttpCode(HttpStatus.OK)
  getScheduleLink(@Query() query: any) {
    return this.usersService.getScheduleLink({
      teacherId: query.teacherId,
      otherUserId: query.otherUserId,
      conversationId: query.conversationId,
    });
  }

  @Post('schedule-group/:roomId/extend')
  @HttpCode(HttpStatus.OK)
  async extendScheduleGroup(
    @Param('roomId') roomId: string,
    @Body() body: any,
    @CurrentUser('id') callerId: string,
  ) {
    await this.assertActingTeacher(callerId, body?.teacherId);
    return this.usersService.extendScheduleGroup(roomId, body);
  }
}
